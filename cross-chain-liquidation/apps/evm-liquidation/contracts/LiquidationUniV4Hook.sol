// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LiquidationHookCore.sol";

interface IPoolManagerLike {
    function take(address currency, address to, uint256 amount) external;
}

contract LiquidationUniV4Hook is LiquidationHookCore {
    error OnlyPoolManager();
    error InvalidHookData();
    error InvalidPool();
    error InvalidSwapDirection();
    error UnsupportedExactOutput();
    error UnexpectedNonPositiveProceeds();

    struct PoolKey {
        address currency0;
        address currency1;
        address hooks;
        address poolManager;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct BalanceDelta {
        int128 amount0;
        int128 amount1;
    }

    struct BeforeSwapDelta {
        int128 amount0;
        int128 amount1;
    }

    struct HookPermissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveLiquidityReturnDelta;
    }

    bytes4 internal constant BEFORE_SWAP_SELECTOR = bytes4(keccak256("beforeSwap(address,(address,address,address,address),(bool,int256,uint160),bytes)"));
    bytes4 internal constant AFTER_SWAP_SELECTOR = bytes4(keccak256("afterSwap(address,(address,address,address,address),(bool,int256,uint160),(int128,int128),bytes)"));

    address public immutable poolManager;
    address public immutable proceedsToken;

    constructor(address liquidationConfig_, address proceedsToken_, address poolManager_)
        LiquidationHookCore(liquidationConfig_)
    {
        if (poolManager_ == address(0) || proceedsToken_ == address(0)) revert InvalidTokenAddress();
        poolManager = poolManager_;
        proceedsToken = proceedsToken_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert OnlyPoolManager();
        _;
    }

    function getHookPermissions() external pure returns (HookPermissions memory permissions) {
        return HookPermissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta memory, uint24) {
        bytes32 intentKey = _decodeIntentKey(hookData);
        uint256 sellAmount = _deriveSellAmount(params);
        _validateLiquidationPath(intentKey, key, params);
        HookExecutionDecision memory decision = this.previewLiquidationSwap(intentKey, sender, sellAmount);
        return (
            BEFORE_SWAP_SELECTOR,
            BeforeSwapDelta({amount0: 0, amount1: 0}),
            uint24(decision.feeOverrideBps)
        );
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta calldata delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        bytes32 intentKey = _decodeIntentKey(hookData);
        uint256 sellAmount = _deriveSellAmount(params);
        _validateLiquidationPath(intentKey, key, params);
        uint256 grossProceeds = _deriveGrossProceeds(intentKey, key, params, delta);
        LiquidationExecutionSettlement memory settlement =
            _previewLiquidationSettlement(intentKey, sender, sellAmount, grossProceeds);
        _settleProceedsFromPoolManager(settlement);
        _recordLiquidationExecution(intentKey, sender, sellAmount, grossProceeds, settlement);
        return (AFTER_SWAP_SELECTOR, 0);
    }

    function _decodeIntentKey(bytes calldata hookData) internal pure returns (bytes32 intentKey) {
        if (hookData.length != 32) revert InvalidHookData();
        intentKey = abi.decode(hookData, (bytes32));
    }

    function _deriveSellAmount(SwapParams calldata params) internal pure returns (uint256 sellAmount) {
        if (params.amountSpecified <= 0) revert UnsupportedExactOutput();
        sellAmount = uint256(params.amountSpecified);
        if (sellAmount == 0) revert InvalidSellAmount();
    }

    function _validateLiquidationPath(
        bytes32 intentKey,
        PoolKey calldata key,
        SwapParams calldata params
    ) internal view {
        (
            bool active,
            ,
            ,
            ,
            address collateralToken,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 expiry
        ) = liquidationConfig.getHookLiquidationContext(intentKey);
        if (!active) revert LiquidationInactive();
        if (expiry <= block.timestamp) revert LiquidationInactive();
        if (key.hooks != address(this) || key.poolManager != poolManager) revert InvalidPool();

        bool collateralIsCurrency0 = key.currency0 == collateralToken && key.currency1 == proceedsToken;
        bool collateralIsCurrency1 = key.currency1 == collateralToken && key.currency0 == proceedsToken;
        if (!collateralIsCurrency0 && !collateralIsCurrency1) revert InvalidPool();

        if (collateralIsCurrency0 && !params.zeroForOne) revert InvalidSwapDirection();
        if (collateralIsCurrency1 && params.zeroForOne) revert InvalidSwapDirection();
    }

    function _deriveGrossProceeds(
        bytes32 intentKey,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta calldata delta
    ) internal view returns (uint256 grossProceeds) {
        (
            ,
            ,
            ,
            ,
            address collateralToken,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 expiry
        ) = liquidationConfig.getHookLiquidationContext(intentKey);
        expiry;
        bool collateralIsCurrency0 = key.currency0 == collateralToken && key.currency1 == proceedsToken;
        bool collateralIsCurrency1 = key.currency1 == collateralToken && key.currency0 == proceedsToken;
        if (!collateralIsCurrency0 && !collateralIsCurrency1) revert InvalidPool();

        if (params.zeroForOne) {
            grossProceeds = _toPositiveUint(-delta.amount1);
        } else {
            grossProceeds = _toPositiveUint(-delta.amount0);
        }

        if (grossProceeds == 0) revert UnexpectedNonPositiveProceeds();
    }

    function _toPositiveUint(int128 value) internal pure returns (uint256) {
        if (value <= 0) revert UnexpectedNonPositiveProceeds();
        return uint256(uint128(value));
    }

    function _settleProceedsFromPoolManager(LiquidationExecutionSettlement memory settlement) internal {
        if (settlement.treasuryFeeAmount > 0) {
            IPoolManagerLike(poolManager).take(proceedsToken, settlement.decision.treasurySink, settlement.treasuryFeeAmount);
        }
        if (settlement.lenderRecoveryAmount > 0) {
            IPoolManagerLike(poolManager).take(proceedsToken, settlement.recoverySink, settlement.lenderRecoveryAmount);
        }
    }
}

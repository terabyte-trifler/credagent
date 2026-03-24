// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidationConfig {
    function getHookLiquidationContext(bytes32 intentKey)
        external
        view
        returns (
            bool active,
            uint256 loanId,
            string memory pool,
            string memory borrowerId,
            address collateralToken,
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            uint16 feeOverrideBps,
            uint16 treasuryFeeSplitBps,
            address treasurySink,
            address recoverySink,
            uint256 expiry
        );
}

contract LiquidationHookCore {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    error LiquidationInactive();
    error UnauthorizedLiquidator();
    error SellAmountExceeded();
    error InvalidSellAmount();
    error InvalidProceedsAmount();
    error InvalidTokenAddress();
    error SellAmountAlreadyConsumed();

    struct HookExecutionDecision {
        bool active;
        address approvedLiquidator;
        uint256 maxLiquidationSize;
        uint16 feeOverrideBps;
        uint16 treasuryFeeSplitBps;
        address treasurySink;
        uint256 expiry;
    }

    struct LiquidationExecutionSettlement {
        uint256 loanId;
        string pool;
        string borrowerId;
        HookExecutionDecision decision;
        uint256 grossProceeds;
        uint256 treasuryFeeAmount;
        uint256 lenderRecoveryAmount;
        uint256 cumulativeSoldAmount;
        address recoverySink;
    }

    event LiquidationExecutionRecorded(
        bytes32 indexed intentKey,
        uint256 indexed loanId,
        string pool,
        string borrowerId,
        address liquidator,
        uint256 sellAmount,
        uint256 grossProceeds,
        uint256 treasuryFeeAmount,
        uint256 lenderRecoveryAmount,
        address treasurySink,
        address recoverySink,
        uint16 treasuryFeeSplitBps,
        uint256 cumulativeSoldAmount
    );

    ILiquidationConfig public immutable liquidationConfig;
    mapping(bytes32 => uint256) public soldAmountByIntent;

    constructor(address liquidationConfig_) {
        if (liquidationConfig_ == address(0)) revert InvalidTokenAddress();
        liquidationConfig = ILiquidationConfig(liquidationConfig_);
    }

    function previewLiquidationSwap(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount
    ) external view returns (HookExecutionDecision memory decision) {
        return _previewLiquidationSwap(intentKey, liquidator, sellAmount);
    }

    function previewLiquidationSettlement(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount,
        uint256 grossProceeds
    ) external view returns (LiquidationExecutionSettlement memory settlement) {
        return _previewLiquidationSettlement(intentKey, liquidator, sellAmount, grossProceeds);
    }

    function isLiquidationExecutionAllowed(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount
    ) external view returns (bool) {
        if (sellAmount == 0) {
            return false;
        }

        (
            bool active,
            ,
            ,
            ,
            ,
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            ,
            ,
            ,
            ,
            uint256 expiry
        ) = liquidationConfig.getHookLiquidationContext(intentKey);

        return
            active &&
            expiry > block.timestamp &&
            (approvedLiquidator == address(0) || liquidator == approvedLiquidator) &&
            soldAmountByIntent[intentKey] + sellAmount <= maxLiquidationSize;
    }

    function _previewLiquidationSwap(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount
    ) internal view returns (HookExecutionDecision memory decision) {
        if (sellAmount == 0) revert InvalidSellAmount();

        (
            bool active,
            ,
            ,
            ,
            ,
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            uint16 feeOverrideBps,
            uint16 treasuryFeeSplitBps,
            address treasurySink,
            ,
            uint256 expiry
        ) = liquidationConfig.getHookLiquidationContext(intentKey);

        if (!active || expiry <= block.timestamp) revert LiquidationInactive();
        if (approvedLiquidator != address(0) && liquidator != approvedLiquidator) {
            revert UnauthorizedLiquidator();
        }
        uint256 cumulativeSoldAmount = soldAmountByIntent[intentKey] + sellAmount;
        if (cumulativeSoldAmount > maxLiquidationSize) revert SellAmountExceeded();

        return HookExecutionDecision({
            active: active,
            approvedLiquidator: approvedLiquidator,
            maxLiquidationSize: maxLiquidationSize,
            feeOverrideBps: feeOverrideBps,
            treasuryFeeSplitBps: treasuryFeeSplitBps,
            treasurySink: treasurySink,
            expiry: expiry
        });
    }

    function _previewLiquidationSettlement(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount,
        uint256 grossProceeds
    ) internal view returns (LiquidationExecutionSettlement memory settlement) {
        if (grossProceeds == 0) revert InvalidProceedsAmount();

        HookExecutionDecision memory decision = _previewLiquidationSwap(intentKey, liquidator, sellAmount);
        (
            ,
            uint256 loanId,
            string memory pool,
            string memory borrowerId,
            ,
            ,
            ,
            ,
            uint16 treasuryFeeSplitBps,
            ,
            address recoverySink,
            uint256 expiry
        ) = liquidationConfig.getHookLiquidationContext(intentKey);
        expiry;
        uint256 cumulativeSoldAmount = soldAmountByIntent[intentKey] + sellAmount;
        if (cumulativeSoldAmount > decision.maxLiquidationSize) revert SellAmountAlreadyConsumed();

        uint256 treasuryFeeAmount = (grossProceeds * treasuryFeeSplitBps) / BPS_DENOMINATOR;
        uint256 lenderRecoveryAmount = grossProceeds - treasuryFeeAmount;

        return LiquidationExecutionSettlement({
            loanId: loanId,
            pool: pool,
            borrowerId: borrowerId,
            decision: decision,
            grossProceeds: grossProceeds,
            treasuryFeeAmount: treasuryFeeAmount,
            lenderRecoveryAmount: lenderRecoveryAmount,
            cumulativeSoldAmount: cumulativeSoldAmount,
            recoverySink: recoverySink
        });
    }

    function _enforceLiquidationSwap(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount,
        uint256 grossProceeds
    ) internal returns (LiquidationExecutionSettlement memory settlement) {
        settlement = _previewLiquidationSettlement(intentKey, liquidator, sellAmount, grossProceeds);
        _recordLiquidationExecution(intentKey, liquidator, sellAmount, grossProceeds, settlement);
    }

    function _recordLiquidationExecution(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount,
        uint256 grossProceeds,
        LiquidationExecutionSettlement memory settlement
    ) internal {
        soldAmountByIntent[intentKey] = settlement.cumulativeSoldAmount;

        emit LiquidationExecutionRecorded(
            intentKey,
            settlement.loanId,
            settlement.pool,
            settlement.borrowerId,
            liquidator,
            sellAmount,
            grossProceeds,
            settlement.treasuryFeeAmount,
            settlement.lenderRecoveryAmount,
            settlement.decision.treasurySink,
            settlement.recoverySink,
            settlement.decision.treasuryFeeSplitBps,
            settlement.cumulativeSoldAmount
        );
    }
}

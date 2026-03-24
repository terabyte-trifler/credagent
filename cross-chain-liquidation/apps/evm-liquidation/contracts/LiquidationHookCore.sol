// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidationConfig {
    function getHookExecutionConfig(bytes32 intentKey)
        external
        view
        returns (
            bool active,
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            uint16 feeOverrideBps,
            uint16 treasuryFeeSplitBps,
            address treasurySink,
            uint256 expiry
        );
}

contract LiquidationHookCore {
    error LiquidationInactive();
    error UnauthorizedLiquidator();
    error SellAmountExceeded();
    error InvalidSellAmount();
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

    ILiquidationConfig public immutable liquidationConfig;
    mapping(bytes32 => uint256) public soldAmountByIntent;

    constructor(address liquidationConfig_) {
        liquidationConfig = ILiquidationConfig(liquidationConfig_);
    }

    function previewLiquidationSwap(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount
    ) external view returns (HookExecutionDecision memory decision) {
        if (sellAmount == 0) revert InvalidSellAmount();

        (
            bool active,
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            uint16 feeOverrideBps,
            uint16 treasuryFeeSplitBps,
            address treasurySink,
            uint256 expiry
        ) = liquidationConfig.getHookExecutionConfig(intentKey);

        if (!active || expiry <= block.timestamp) revert LiquidationInactive();
        if (approvedLiquidator != address(0) && liquidator != approvedLiquidator) {
            revert UnauthorizedLiquidator();
        }
        if (sellAmount > maxLiquidationSize) revert SellAmountExceeded();

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

    function enforceLiquidationSwap(
        bytes32 intentKey,
        address liquidator,
        uint256 sellAmount
    ) external returns (HookExecutionDecision memory decision) {
        decision = this.previewLiquidationSwap(intentKey, liquidator, sellAmount);
        uint256 newSoldAmount = soldAmountByIntent[intentKey] + sellAmount;
        if (newSoldAmount > decision.maxLiquidationSize) revert SellAmountAlreadyConsumed();
        soldAmountByIntent[intentKey] = newSoldAmount;
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
            address approvedLiquidator,
            uint256 maxLiquidationSize,
            ,
            ,
            ,
            uint256 expiry
        ) = liquidationConfig.getHookExecutionConfig(intentKey);

        return
            active &&
            expiry > block.timestamp &&
            (approvedLiquidator == address(0) || liquidator == approvedLiquidator) &&
            sellAmount <= maxLiquidationSize;
    }
}

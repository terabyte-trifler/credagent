// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LiquidationConfig {
    struct LiquidationPayload {
        uint256 loanId;
        string pool;
        string borrowerId;
        string collateralMint;
        address collateralToken;
        uint256 amountToLiquidate;
        uint256 debtOutstanding;
        uint256 minimumRecoveryTarget;
        string liquidationMode;
        string liquidationUrgency;
        address approvedLiquidator;
        address treasurySink;
        uint16 feeOverrideBps;
        uint16 treasuryFeeSplitBps;
        uint256 maxLiquidationSize;
        uint256 expiry;
        uint256 nonce;
        uint256 targetChainId;
        string sourceProgram;
    }

    struct ActiveLiquidation {
        uint256 loanId;
        string pool;
        string borrowerId;
        string collateralMint;
        address collateralToken;
        uint256 amountToLiquidate;
        uint256 debtOutstanding;
        uint256 minimumRecoveryTarget;
        string liquidationMode;
        string liquidationUrgency;
        address approvedLiquidator;
        address treasurySink;
        uint16 feeOverrideBps;
        uint16 treasuryFeeSplitBps;
        uint256 maxLiquidationSize;
        uint256 expiry;
        uint256 nonce;
        uint256 targetChainId;
        string sourceProgram;
        bytes32 payloadHash;
        string canonicalPayload;
        string protocolSignerId;
        address protocolSignerAddress;
        bytes32 nonceScopeKey;
        bool active;
    }

    error UnauthorizedUpdater();
    error InvalidSigner();
    error InvalidPayloadHash();
    error CanonicalPayloadMismatch();
    error InvalidSignatureLength();
    error SignatureRecoveryFailed();
    error ExpiredIntent();
    error InvalidTargetChain();
    error StaleNonce();
    error InvalidTreasurySink();
    error InvalidApprovedLiquidator();
    error InvalidAmount();

    event LiquidationIntentStored(
        bytes32 indexed intentKey,
        bytes32 indexed nonceScopeKey,
        uint256 indexed loanId,
        uint256 nonce,
        bytes32 payloadHash,
        address protocolSignerAddress,
        uint256 expiry
    );

    event LiquidationIntentExpired(bytes32 indexed intentKey, uint256 indexed loanId);

    uint256 public immutable localChainId;
    address public owner;
    mapping(address => bool) public authorizedUpdaters;
    mapping(address => bool) public authorizedSigners;
    mapping(bytes32 => ActiveLiquidation) private activeLiquidations;
    mapping(bytes32 => uint256) public lastNonceByScope;
    mapping(bytes32 => bytes32) public latestIntentKeyByScope;

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedUpdater();
        _;
    }

    modifier onlyAuthorizedUpdater() {
        if (!authorizedUpdaters[msg.sender]) revert UnauthorizedUpdater();
        _;
    }

    constructor(uint256 chainId_, address initialUpdater, address initialSigner) {
        owner = msg.sender;
        localChainId = chainId_;
        authorizedUpdaters[msg.sender] = true;
        if (initialUpdater != address(0)) {
            authorizedUpdaters[initialUpdater] = true;
        }
        if (initialSigner != address(0)) {
            authorizedSigners[initialSigner] = true;
        }
    }

    function setAuthorizedUpdater(address updater, bool allowed) external onlyOwner {
        authorizedUpdaters[updater] = allowed;
    }

    function setAuthorizedSigner(address signer, bool allowed) external onlyOwner {
        authorizedSigners[signer] = allowed;
    }

    function submitLiquidationIntent(
        LiquidationPayload calldata payload,
        string calldata canonicalPayload,
        bytes32 payloadHash,
        string calldata protocolSignerId,
        address protocolSignerAddress,
        bytes calldata signature
    ) external onlyAuthorizedUpdater returns (bytes32 intentKey) {
        if (payload.targetChainId != localChainId) revert InvalidTargetChain();
        if (payload.expiry <= block.timestamp) revert ExpiredIntent();
        if (payload.amountToLiquidate == 0 || payload.maxLiquidationSize == 0) revert InvalidAmount();
        if (payload.treasurySink == address(0)) revert InvalidTreasurySink();
        if (payload.approvedLiquidator == address(0)) revert InvalidApprovedLiquidator();
        if (bytes(payload.borrowerId).length == 0 || payload.collateralToken == address(0)) revert InvalidAmount();
        string memory derivedCanonicalPayload = _canonicalizePayload(payload);
        if (keccak256(bytes(canonicalPayload)) != keccak256(bytes(derivedCanonicalPayload))) {
            revert CanonicalPayloadMismatch();
        }
        if (payloadHash != keccak256(bytes(canonicalPayload))) revert InvalidPayloadHash();
        if (!authorizedSigners[protocolSignerAddress]) revert InvalidSigner();

        bytes32 nonceScopeKey = computeNonceScopeKey(payload.targetChainId, payload.pool, payload.loanId);
        if (payload.nonce <= lastNonceByScope[nonceScopeKey]) revert StaleNonce();

        address recoveredSigner = _recoverSigner(payloadHash, signature);
        if (recoveredSigner != protocolSignerAddress) revert InvalidSigner();

        intentKey = computeIntentKey(payload.targetChainId, payload.pool, payload.loanId, payload.nonce);
        bytes32 previousIntentKey = latestIntentKeyByScope[nonceScopeKey];
        if (previousIntentKey != bytes32(0)) {
            activeLiquidations[previousIntentKey].active = false;
        }
        lastNonceByScope[nonceScopeKey] = payload.nonce;
        latestIntentKeyByScope[nonceScopeKey] = intentKey;

        activeLiquidations[intentKey] = ActiveLiquidation({
            loanId: payload.loanId,
            pool: payload.pool,
            borrowerId: payload.borrowerId,
            collateralMint: payload.collateralMint,
            collateralToken: payload.collateralToken,
            amountToLiquidate: payload.amountToLiquidate,
            debtOutstanding: payload.debtOutstanding,
            minimumRecoveryTarget: payload.minimumRecoveryTarget,
            liquidationMode: payload.liquidationMode,
            liquidationUrgency: payload.liquidationUrgency,
            approvedLiquidator: payload.approvedLiquidator,
            treasurySink: payload.treasurySink,
            feeOverrideBps: payload.feeOverrideBps,
            treasuryFeeSplitBps: payload.treasuryFeeSplitBps,
            maxLiquidationSize: payload.maxLiquidationSize,
            expiry: payload.expiry,
            nonce: payload.nonce,
            targetChainId: payload.targetChainId,
            sourceProgram: payload.sourceProgram,
            payloadHash: payloadHash,
            canonicalPayload: canonicalPayload,
            protocolSignerId: protocolSignerId,
            protocolSignerAddress: protocolSignerAddress,
            nonceScopeKey: nonceScopeKey,
            active: true
        });

        emit LiquidationIntentStored(
            intentKey,
            nonceScopeKey,
            payload.loanId,
            payload.nonce,
            payloadHash,
            protocolSignerAddress,
            payload.expiry
        );
    }

    function isLiquidationActive(bytes32 intentKey) public view returns (bool) {
        ActiveLiquidation storage liquidation = activeLiquidations[intentKey];
        return
            liquidation.active &&
            liquidation.expiry > block.timestamp &&
            latestIntentKeyByScope[liquidation.nonceScopeKey] == intentKey;
    }

    function getActiveLiquidation(bytes32 intentKey) external view returns (ActiveLiquidation memory) {
        return activeLiquidations[intentKey];
    }

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
        )
    {
        ActiveLiquidation storage liquidation = activeLiquidations[intentKey];
        return (
            liquidation.active &&
                liquidation.expiry > block.timestamp &&
                latestIntentKeyByScope[liquidation.nonceScopeKey] == intentKey,
            liquidation.approvedLiquidator,
            liquidation.maxLiquidationSize,
            liquidation.feeOverrideBps,
            liquidation.treasuryFeeSplitBps,
            liquidation.treasurySink,
            liquidation.expiry
        );
    }

    function expireLiquidation(bytes32 intentKey) external returns (bool) {
        ActiveLiquidation storage liquidation = activeLiquidations[intentKey];
        if (!liquidation.active) {
            return false;
        }
        if (liquidation.expiry > block.timestamp) {
            return false;
        }
        liquidation.active = false;
        emit LiquidationIntentExpired(intentKey, liquidation.loanId);
        return true;
    }

    function computeIntentKey(
        uint256 targetChainId,
        string memory pool,
        uint256 loanId,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(targetChainId, pool, loanId, nonce));
    }

    function computeNonceScopeKey(
        uint256 targetChainId,
        string memory pool,
        uint256 loanId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(targetChainId, pool, loanId));
    }

    function _recoverSigner(bytes32 payloadHash, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) revert SignatureRecoveryFailed();
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) {
            revert SignatureRecoveryFailed();
        }

        address recovered = ecrecover(payloadHash, v, r, s);
        if (recovered == address(0)) revert SignatureRecoveryFailed();
        return recovered;
    }

    function _canonicalizePayload(LiquidationPayload calldata payload) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "amountToLiquidate=", _uintToString(payload.amountToLiquidate), "\n",
                "approvedLiquidator=", _addressToLowerHex(payload.approvedLiquidator), "\n",
                "borrowerId=", payload.borrowerId, "\n",
                "collateralMint=", payload.collateralMint, "\n",
                "collateralToken=", _addressToLowerHex(payload.collateralToken), "\n",
                "debtOutstanding=", _uintToString(payload.debtOutstanding), "\n",
                "expiry=", _uintToString(payload.expiry), "\n",
                "feeOverrideBps=", _uintToString(payload.feeOverrideBps), "\n",
                "liquidationMode=", payload.liquidationMode, "\n",
                "liquidationUrgency=", payload.liquidationUrgency, "\n",
                "loanId=", _uintToString(payload.loanId), "\n",
                "maxLiquidationSize=", _uintToString(payload.maxLiquidationSize), "\n",
                "minimumRecoveryTarget=", _uintToString(payload.minimumRecoveryTarget), "\n",
                "nonce=", _uintToString(payload.nonce), "\n",
                "pool=", payload.pool, "\n",
                "sourceProgram=", payload.sourceProgram, "\n",
                "targetChainId=", _uintToString(payload.targetChainId), "\n",
                "treasuryFeeSplitBps=", _uintToString(payload.treasuryFeeSplitBps), "\n",
                "treasurySink=", _addressToLowerHex(payload.treasurySink)
            )
        );
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _addressToLowerHex(address account) internal pure returns (string memory) {
        bytes20 value = bytes20(account);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(str);
    }
}

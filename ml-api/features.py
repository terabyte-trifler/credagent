"""
T2A.1 — On-Chain Feature Extraction (14 Categories)

Extracts behavioral features from Solana wallet addresses for credit scoring.
Supports:
  - live RPC-backed extraction for real wallets
  - deterministic demo extraction for tests / offline fallback

SECURITY:
- Address validated as base58 before any processing
- Feature values clamped to sane ranges (no unbounded outputs)
- Live mode uses public RPC only and fails back to safer defaults
- No private data stored — all features from public on-chain data
- Demo mode remains deterministic for tests
"""

import hashlib
import json
import math
import os
import re
import time
from typing import Iterable

import numpy as np
import requests

SOLANA_BASE58_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
SOLANA_RPC_URL_DEVNET = os.getenv("SOLANA_RPC_URL_DEVNET", "https://api.devnet.solana.com")
SOLANA_RPC_URL_MAINNET = os.getenv("SOLANA_RPC_URL_MAINNET", SOLANA_RPC_URL)
ORACLE_PROGRAM_ID = os.getenv("CREDIT_ORACLE_PROGRAM_ID", "4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE")
SOL_USD_FALLBACK = float(os.getenv("SOL_USD_FALLBACK", "150"))
LIVE_SIGNATURE_LIMIT = int(os.getenv("LIVE_SIGNATURE_LIMIT", "120"))
LIVE_TX_SAMPLE_LIMIT = int(os.getenv("LIVE_TX_SAMPLE_LIMIT", "40"))
RPC_CACHE_TTL_SECS = int(os.getenv("RPC_CACHE_TTL_SECS", "300"))
FEATURE_CACHE_TTL_SECS = int(os.getenv("FEATURE_CACHE_TTL_SECS", "600"))

FEATURE_SCHEMA = {
    "tx_count_90d": {"type": "int", "min": 0, "max": 100_000, "desc": "Transactions in last 90 days"},
    "tx_volume_90d_usd": {"type": "float", "min": 0.0, "max": 1e9, "desc": "USD volume in last 90 days"},
    "wallet_age_days": {"type": "int", "min": 0, "max": 10_000, "desc": "Days since first transaction"},
    "defi_protocols_used": {"type": "int", "min": 0, "max": 100, "desc": "Unique DeFi protocols interacted with"},
    "total_borrowed_usd": {"type": "float", "min": 0.0, "max": 1e9, "desc": "Estimated lifetime USD borrowed across protocols"},
    "total_repaid_usd": {"type": "float", "min": 0.0, "max": 1e9, "desc": "Estimated lifetime USD repaid"},
    "liquidation_count": {"type": "int", "min": 0, "max": 1000, "desc": "Detected liquidation-like events"},
    "token_diversity": {"type": "int", "min": 0, "max": 500, "desc": "Unique SPL tokens currently held"},
    "avg_balance_30d_usd": {"type": "float", "min": 0.0, "max": 1e9, "desc": "Observed USD balance proxy over 30 days"},
    "payment_regularity": {"type": "float", "min": 0.0, "max": 1.0, "desc": "Repayment consistency score (0-1)"},
    "governance_votes": {"type": "int", "min": 0, "max": 10_000, "desc": "Governance interactions detected"},
    "nft_attestations": {"type": "int", "min": 0, "max": 100, "desc": "Identity NFTs/SBT-like holdings"},
    "cross_chain_activity": {"type": "int", "min": 0, "max": 50, "desc": "Bridge / cross-chain activity count"},
    "counterparty_reputation": {"type": "float", "min": 0.0, "max": 1.0, "desc": "Observed counterparty quality proxy"},
}

FEATURE_NAMES = list(FEATURE_SCHEMA.keys())
NUM_FEATURES = len(FEATURE_NAMES)

SYSTEM_PROGRAMS = {
    "11111111111111111111111111111111",
    "Vote111111111111111111111111111111111111111",
    "Stake11111111111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    "ComputeBudget111111111111111111111111111111",
    "AddressLookupTab1e1111111111111111111111111",
}

DEFI_HINTS = (
    "margin", "solend", "kamino", "drift", "mango", "port", "francium", "zeta",
    "cykura", "orca", "raydium", "meteora", "jupiter", "marinade", "flash",
)
GOVERNANCE_HINTS = ("realm", "govern", "tribeca", "squad")
BRIDGE_HINTS = ("worm", "allbridge", "mayan", "portal", "debridge")
LIQUIDATION_HINTS = ("liquid", "margin", "drift", "solend", "kamino")

_SESSION = requests.Session()
_RPC_CACHE: dict[tuple[str, str, str], tuple[float, object]] = {}
_FEATURE_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}

CREDIT_HISTORY_ACCOUNT_SIZE = 79


def _read_u16_le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset: offset + 2], "little", signed=False)


def _read_u64_le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset: offset + 8], "little", signed=False)


def _read_i64_le(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset: offset + 8], "little", signed=True)


def _fetch_credit_history(address: str, rpc_url: str) -> dict | None:
    """
    Read the protocol-native CreditHistory account from credit_score_oracle.

    We intentionally use getProgramAccounts + borrower memcmp instead of deriving
    PDAs locally so this stays dependency-light and works with plain JSON-RPC.
    """
    try:
        accounts = _rpc(
            "getProgramAccounts",
            [
                ORACLE_PROGRAM_ID,
                {
                    "encoding": "base64",
                    "filters": [
                        {"dataSize": CREDIT_HISTORY_ACCOUNT_SIZE},
                        {"memcmp": {"offset": 8, "bytes": address}},
                    ],
                },
            ],
            rpc_url,
        ) or []
    except Exception:
        return None


def resolve_rpc_url(cluster: str | None = None, rpc_url: str | None = None) -> str:
    if rpc_url:
        return rpc_url
    normalized_cluster = (cluster or "").lower()
    if normalized_cluster == "devnet":
        return SOLANA_RPC_URL_DEVNET
    if normalized_cluster in {"mainnet", "mainnet-beta"}:
        return SOLANA_RPC_URL_MAINNET
    return SOLANA_RPC_URL

    if not accounts:
        return None

    try:
        encoded = accounts[0]["account"]["data"][0]
        raw = __import__("base64").b64decode(encoded)
        body = raw[8:]
        return {
            "total_loans": _read_u16_le(body, 32),
            "repaid_loans": _read_u16_le(body, 34),
            "defaulted_loans": _read_u16_le(body, 36),
            "total_borrowed_usd": _read_u64_le(body, 38) / 1_000_000,
            "total_repaid_usd": _read_u64_le(body, 46) / 1_000_000,
            "first_loan_date": _read_i64_le(body, 54),
            "last_activity": _read_i64_le(body, 62),
        }
    except Exception:
        return None


def validate_address(address: str) -> str:
    if not isinstance(address, str):
        raise ValueError(f"Address must be string, got {type(address).__name__}")
    address = address.strip()
    if not SOLANA_BASE58_RE.match(address):
        raise ValueError(f"Invalid Solana address: {address[:12]}...")
    return address


def clamp_feature(name: str, value) -> float:
    schema = FEATURE_SCHEMA.get(name)
    if schema is None:
        raise ValueError(f"Unknown feature: {name}")
    if schema["type"] == "int":
        value = int(round(float(value)))
    else:
        value = float(value)
    return max(schema["min"], min(schema["max"], value))


def validate_features(features: dict) -> dict:
    clean = {}
    for name in FEATURE_NAMES:
        raw = features.get(name, 0)
        try:
            clean[name] = clamp_feature(name, raw)
        except (ValueError, TypeError):
            clean[name] = 0
    return clean


def _rpc(method: str, params: list, rpc_url: str) -> dict:
    cache_key = (rpc_url, method, json.dumps(params, sort_keys=True, default=str))
    now = time.time()
    cached = _RPC_CACHE.get(cache_key)
    if cached and now - cached[0] < RPC_CACHE_TTL_SECS:
        return cached[1]

    response = _SESSION.post(
        rpc_url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise RuntimeError(payload["error"].get("message", "RPC error"))
    _RPC_CACHE[cache_key] = (now, payload["result"])
    return payload["result"]


def _extract_pubkey(entry) -> str | None:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("pubkey")
    return None


def _program_matches(program_ids: Iterable[str], hints: tuple[str, ...]) -> int:
    count = 0
    for program_id in program_ids:
        lowered = str(program_id).lower()
        if any(hint in lowered for hint in hints):
            count += 1
    return count


def _counterparty_score(tx_count_90d: int, protocol_count: int, token_diversity: int, age_days: int) -> float:
    return max(
        0.0,
        min(
            1.0,
            0.05
            + min(tx_count_90d / 300, 1.0) * 0.35
            + min(protocol_count / 8, 1.0) * 0.30
            + min(token_diversity / 12, 1.0) * 0.15
            + min(age_days / 730, 1.0) * 0.15,
        ),
    )


def _regularity_score(recent_timestamps: list[int], borrowed_usd: float, repaid_usd: float) -> float:
    if borrowed_usd <= 0:
        return 0.0
    if len(recent_timestamps) < 3:
        return 0.2 if repaid_usd > 0 else 0.05
    recent_timestamps = sorted(recent_timestamps, reverse=True)
    gaps = [recent_timestamps[i] - recent_timestamps[i + 1] for i in range(len(recent_timestamps) - 1)]
    if not gaps:
        return 0.1
    avg_gap = sum(gaps) / len(gaps)
    spread = max(gaps) - min(gaps)
    if avg_gap <= 0:
        return 0.1
    stability = max(0.0, 1.0 - (spread / avg_gap))
    repay_ratio = min(repaid_usd / max(borrowed_usd, 1.0), 1.0)
    return max(0.0, min(1.0, stability * 0.5 + repay_ratio * 0.5))


def extract_features_live(
    address: str,
    rpc_url: str | None = None,
    force_fresh: bool = False,
    cluster: str | None = None,
) -> dict:
    """
    Live feature extraction from public Solana RPC.

    This is intentionally conservative:
    - if we cannot observe positive lending/repayment evidence, we do not invent it
    - missing protocol-specific credit history stays near zero instead of neutral
    """
    address = validate_address(address)
    rpc_url = resolve_rpc_url(cluster=cluster, rpc_url=rpc_url)
    cache_key = (rpc_url, address)
    now_ts = time.time()
    cached = _FEATURE_CACHE.get(cache_key)
    if not force_fresh and cached and now_ts - cached[0] < FEATURE_CACHE_TTL_SECS:
        return cached[1]

    if address in SYSTEM_PROGRAMS:
        features = validate_features({
            "tx_count_90d": 0,
            "tx_volume_90d_usd": 0.0,
            "wallet_age_days": 3000,
            "defi_protocols_used": 0,
            "total_borrowed_usd": 0.0,
            "total_repaid_usd": 0.0,
            "liquidation_count": 0,
            "token_diversity": 0,
            "avg_balance_30d_usd": 0.0,
            "payment_regularity": 0.0,
            "governance_votes": 0,
            "nft_attestations": 0,
            "cross_chain_activity": 0,
            "counterparty_reputation": 0.05,
        })
        _FEATURE_CACHE[cache_key] = (now_ts, features)
        return features

    now = int(time.time())
    cutoff_90d = now - 90 * 24 * 60 * 60

    sigs = _rpc("getSignaturesForAddress", [address, {"limit": LIVE_SIGNATURE_LIMIT}], rpc_url) or []
    recent_sigs = [entry for entry in sigs if (entry.get("blockTime") or 0) >= cutoff_90d]
    tx_count_90d = len(recent_sigs)

    oldest_block_time = min((entry.get("blockTime") or now) for entry in sigs) if sigs else now
    wallet_age_days = max(0, int((now - oldest_block_time) // 86400))

    signature_sample = [entry["signature"] for entry in recent_sigs[:LIVE_TX_SAMPLE_LIMIT] if entry.get("signature")]
    program_ids = set()
    balance_deltas_usd = []
    recent_timestamps = []

    for signature in signature_sample:
        try:
            tx = _rpc(
                "getTransaction",
                [signature, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}],
                rpc_url,
            )
        except Exception:
            continue
        if not tx:
            continue
        block_time = tx.get("blockTime") or now
        recent_timestamps.append(block_time)
        meta = tx.get("meta") or {}
        message = ((tx.get("transaction") or {}).get("message")) or {}
        account_keys = message.get("accountKeys") or []

        for instruction in message.get("instructions") or []:
            program_id = instruction.get("programId")
            if program_id:
                program_ids.add(program_id)
        for group in meta.get("innerInstructions") or []:
            for instruction in group.get("instructions") or []:
                program_id = instruction.get("programId")
                if program_id:
                    program_ids.add(program_id)

        owner_index = None
        for idx, entry in enumerate(account_keys):
            if _extract_pubkey(entry) == address:
                owner_index = idx
                break
        if owner_index is not None:
            try:
                pre_balances = meta.get("preBalances") or []
                post_balances = meta.get("postBalances") or []
                lamport_delta = abs((post_balances[owner_index] - pre_balances[owner_index]) / 1e9)
                balance_deltas_usd.append(lamport_delta * SOL_USD_FALLBACK)
            except Exception:
                pass

    current_balance = _rpc("getBalance", [address, {"commitment": "confirmed"}], rpc_url)
    current_balance_usd = ((current_balance or {}).get("value", 0) / 1e9) * SOL_USD_FALLBACK

    token_accounts = {"value": []}
    if tx_count_90d > 0 or current_balance_usd > 1.0:
        token_accounts = _rpc(
            "getTokenAccountsByOwner",
            [address, {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}, {"encoding": "jsonParsed"}],
            rpc_url,
        ) or {"value": []}

    token_mints = set()
    nft_like = 0
    for entry in token_accounts.get("value", []):
        parsed = (((entry.get("account") or {}).get("data") or {}).get("parsed") or {}).get("info") or {}
        mint = parsed.get("mint")
        token_amount = (parsed.get("tokenAmount") or {})
        ui_amount = token_amount.get("uiAmount") or 0
        decimals = token_amount.get("decimals", 0)
        if mint and ui_amount and ui_amount > 0:
            token_mints.add(mint)
            if decimals == 0 and ui_amount <= 1:
                nft_like += 1

    observable_programs = {pid for pid in program_ids if pid not in SYSTEM_PROGRAMS}
    defi_protocols_used = min(len(observable_programs), FEATURE_SCHEMA["defi_protocols_used"]["max"])
    governance_votes = _program_matches(observable_programs, GOVERNANCE_HINTS)
    cross_chain_activity = max(0, min(5, _program_matches(observable_programs, BRIDGE_HINTS)))
    liquidation_count = max(0, min(5, _program_matches(observable_programs, LIQUIDATION_HINTS) // 2))
    tx_volume_90d_usd = float(sum(balance_deltas_usd))

    # Conservative lending activity heuristics:
    # no clear DeFi interaction => near-zero credit history
    lending_signal = min(defi_protocols_used / 6, 1.0)
    borrowed_estimate = tx_volume_90d_usd * (0.10 + lending_signal * 0.35)
    if defi_protocols_used == 0:
        borrowed_estimate = 0.0
    repaid_estimate = borrowed_estimate * max(0.0, min(1.0, 0.20 + lending_signal * 0.45 - liquidation_count * 0.10))
    payment_regularity = _regularity_score(recent_timestamps, borrowed_estimate, repaid_estimate)
    counterparty_reputation = _counterparty_score(
        tx_count_90d=tx_count_90d,
        protocol_count=defi_protocols_used,
        token_diversity=len(token_mints),
        age_days=wallet_age_days,
    )

    avg_balance_30d_usd = current_balance_usd * 0.7 + min(tx_volume_90d_usd / 30.0, current_balance_usd * 0.5 + 250.0)

    # Protocol-native credit history should outweigh heuristics when present.
    protocol_history = _fetch_credit_history(address, rpc_url)
    if protocol_history:
        borrowed_estimate = max(borrowed_estimate, float(protocol_history["total_borrowed_usd"]))
        repaid_estimate = max(repaid_estimate, float(protocol_history["total_repaid_usd"]))
        liquidation_count = max(liquidation_count, int(protocol_history["defaulted_loans"]))

        total_loans = max(0, int(protocol_history["total_loans"]))
        repaid_loans = max(0, int(protocol_history["repaid_loans"]))
        if total_loans > 0:
            protocol_regularity = max(0.0, min(1.0, repaid_loans / total_loans))
            payment_regularity = max(payment_regularity, protocol_regularity)
            # A borrower with real protocol loan history should not look like a pure thin file.
            defi_protocols_used = max(defi_protocols_used, 1)

        first_loan_date = int(protocol_history["first_loan_date"] or 0)
        if first_loan_date > 0:
            protocol_history_age_days = max(0, int((now - first_loan_date) // 86400))
            wallet_age_days = max(wallet_age_days, protocol_history_age_days)

    raw = {
        "tx_count_90d": tx_count_90d,
        "tx_volume_90d_usd": tx_volume_90d_usd,
        "wallet_age_days": wallet_age_days,
        "defi_protocols_used": defi_protocols_used,
        "total_borrowed_usd": borrowed_estimate,
        "total_repaid_usd": repaid_estimate,
        "liquidation_count": liquidation_count,
        "token_diversity": len(token_mints),
        "avg_balance_30d_usd": avg_balance_30d_usd,
        "payment_regularity": payment_regularity,
        "governance_votes": governance_votes,
        "nft_attestations": nft_like,
        "cross_chain_activity": cross_chain_activity,
        "counterparty_reputation": counterparty_reputation,
    }

    features = validate_features(raw)
    _FEATURE_CACHE[cache_key] = (now_ts, features)
    return features


def extract_features_demo(address: str) -> dict:
    address = validate_address(address)
    addr_hash = int(hashlib.sha256(address.lower().encode("utf-8")).hexdigest(), 16)
    rng = np.random.RandomState(addr_hash % (2**31))

    wallet_age = int(rng.randint(1, 1500))
    tx_count = int(rng.randint(0, 180))
    protocol_count = int(rng.randint(0, 6))
    total_borrowed = round(float(rng.lognormal(6.6, 1.9)) if protocol_count > 0 else 0.0, 2)
    repay_ratio = float(rng.beta(4, 4)) if total_borrowed > 0 else 0.0
    total_repaid = round(total_borrowed * repay_ratio, 2)

    raw = {
        "tx_count_90d": tx_count,
        "tx_volume_90d_usd": round(float(rng.lognormal(6.2, 1.8)), 2),
        "wallet_age_days": wallet_age,
        "defi_protocols_used": protocol_count,
        "total_borrowed_usd": total_borrowed,
        "total_repaid_usd": total_repaid,
        "liquidation_count": int(rng.choice([0, 0, 0, 1, 2, 3], p=[0.45, 0.20, 0.15, 0.10, 0.06, 0.04])),
        "token_diversity": int(rng.randint(0, 12)),
        "avg_balance_30d_usd": round(float(rng.lognormal(5.7, 1.7)), 2),
        "payment_regularity": round(float(rng.beta(3, 5)) if total_borrowed > 0 else 0.0, 4),
        "governance_votes": int(rng.randint(0, 4)),
        "nft_attestations": int(rng.randint(0, 3)),
        "cross_chain_activity": int(rng.randint(0, 3)),
        "counterparty_reputation": round(float(rng.beta(3, 4)), 4),
    }

    return validate_features(raw)


def extract_features(
    address: str,
    mode: str = "auto",
    rpc_url: str | None = None,
    force_fresh: bool = False,
    cluster: str | None = None,
) -> tuple[dict, str]:
    """
    Extract features using live RPC when possible and fall back safely.
    Returns (features, extraction_mode_used).
    """
    normalized_mode = (mode or "auto").lower()
    if normalized_mode == "demo":
        return extract_features_demo(address), "demo"
    if normalized_mode == "live":
        return extract_features_live(
            address,
            rpc_url=rpc_url,
            force_fresh=force_fresh,
            cluster=cluster,
        ), "live"
    try:
        return extract_features_live(
            address,
            rpc_url=rpc_url,
            force_fresh=force_fresh,
            cluster=cluster,
        ), "live"
    except Exception:
        return extract_features_demo(address), "demo"


def features_to_vector(features: dict) -> np.ndarray:
    validated = validate_features(features)
    return np.array([validated[name] for name in FEATURE_NAMES], dtype=np.float64)

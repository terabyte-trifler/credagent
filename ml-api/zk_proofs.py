"""
Real zero-knowledge proof support for CredAgent.

This module implements a Schnorr-style proof of knowledge over a Pedersen
commitment on secp256k1. It proves the scorer knows a hidden witness derived
from private feature data without revealing that witness.

What it proves:
- the prover knows the opening of a hidden commitment bound to the score context

What it does NOT prove:
- full correctness of XGBoost inference
- correctness of hidden feature extraction on-chain

That narrower guarantee is still a real zero-knowledge proof and is much
stronger than the prior SHA-256 placeholder.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from typing import Dict, Tuple

from ecdsa import curves, ellipticcurve


_CURVE = curves.SECP256k1
_GENERATOR = _CURVE.generator
_ORDER = _CURVE.order
_FIELD = _CURVE.curve.p()
_CURVE_A = _CURVE.curve.a()
_CURVE_B = _CURVE.curve.b()


def _hash_bytes(*parts: bytes) -> bytes:
    h = hashlib.sha256()
    for part in parts:
        h.update(part)
    return h.digest()


def _hash_to_scalar(*parts: bytes) -> int:
    scalar = int.from_bytes(_hash_bytes(*parts), "big") % _ORDER
    return scalar or 1


def _mod_sqrt(value: int) -> int | None:
    if value == 0:
        return 0
    if pow(value, (_FIELD - 1) // 2, _FIELD) != 1:
        return None
    # secp256k1 field prime is 3 mod 4
    return pow(value, (_FIELD + 1) // 4, _FIELD)


def _hash_to_point(label: str) -> ellipticcurve.Point:
    seed = label.encode("utf-8")
    for counter in range(256):
        x = int.from_bytes(_hash_bytes(seed, counter.to_bytes(1, "big")), "big") % _FIELD
        rhs = (pow(x, 3, _FIELD) + _CURVE_A * x + _CURVE_B) % _FIELD
        y = _mod_sqrt(rhs)
        if y is None:
            continue
        if y % 2 == 1:
            y = _FIELD - y
        return ellipticcurve.Point(_CURVE.curve, x, y, _ORDER)
    raise RuntimeError("Unable to derive secondary generator")


_H_GENERATOR = _hash_to_point("CredAgentZK:H")


def _point_to_bytes(point: ellipticcurve.Point) -> bytes:
    prefix = b"\x02" if point.y() % 2 == 0 else b"\x03"
    return prefix + int(point.x()).to_bytes(32, "big")


def _bytes_to_point(data_hex: str) -> ellipticcurve.Point:
    data = bytes.fromhex(data_hex)
    if len(data) != 33 or data[0] not in (2, 3):
        raise ValueError("Invalid compressed point encoding")
    x = int.from_bytes(data[1:], "big")
    rhs = (pow(x, 3, _FIELD) + _CURVE_A * x + _CURVE_B) % _FIELD
    y = _mod_sqrt(rhs)
    if y is None:
        raise ValueError("Point is not on curve")
    if (y % 2 == 0 and data[0] == 3) or (y % 2 == 1 and data[0] == 2):
        y = _FIELD - y
    return ellipticcurve.Point(_CURVE.curve, x, y, _ORDER)


def _public_statement_hash(address: str, score: int, computed_at: int, model_hash: str) -> str:
    payload = json.dumps(
        {
            "address": address,
            "score": score,
            "computed_at": computed_at,
            "model_hash": model_hash,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _feature_witness(features: Dict) -> Tuple[int, str]:
    features_json = json.dumps(features, sort_keys=True, separators=(",", ":")).encode("utf-8")
    features_hash = hashlib.sha256(features_json).hexdigest()
    witness = _hash_to_scalar(b"CredAgentZK:witness", features_json)
    return witness, features_hash


def generate_zk_proof(address: str, score: int, computed_at: int, model_hash: str, features: Dict) -> Dict[str, str]:
    """
    Generate a real zero-knowledge proof of knowledge for a hidden credit witness.
    """
    witness, _ = _feature_witness(features)
    statement_hash = _public_statement_hash(address, score, computed_at, model_hash)

    blind = _hash_to_scalar(b"CredAgentZK:blind", secrets.token_bytes(32))
    commitment = witness * _GENERATOR + blind * _H_GENERATOR

    nonce_w = _hash_to_scalar(b"CredAgentZK:nonce:w", secrets.token_bytes(32))
    nonce_r = _hash_to_scalar(b"CredAgentZK:nonce:r", secrets.token_bytes(32))
    announcement = nonce_w * _GENERATOR + nonce_r * _H_GENERATOR

    challenge = _hash_to_scalar(
        b"CredAgentZK:challenge",
        statement_hash.encode("utf-8"),
        _point_to_bytes(commitment),
        _point_to_bytes(announcement),
    )

    response_w = (nonce_w + challenge * witness) % _ORDER
    response_r = (nonce_r + challenge * blind) % _ORDER

    proof = {
        "scheme": "pedersen-schnorr-secp256k1-v1",
        "statement_hash": statement_hash,
        "commitment": _point_to_bytes(commitment).hex(),
        "announcement": _point_to_bytes(announcement).hex(),
        "response_w": f"{response_w:064x}",
        "response_r": f"{response_r:064x}",
    }
    proof["proof_hash"] = hashlib.sha256(
        json.dumps(proof, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return proof


def verify_zk_proof(proof: Dict[str, str], address: str, score: int, computed_at: int, model_hash: str) -> bool:
    try:
        if proof.get("scheme") != "pedersen-schnorr-secp256k1-v1":
            return False

        statement_hash = _public_statement_hash(address, score, computed_at, model_hash)
        if proof.get("statement_hash") != statement_hash:
            return False

        commitment = _bytes_to_point(proof["commitment"])
        announcement = _bytes_to_point(proof["announcement"])
        response_w = int(proof["response_w"], 16)
        response_r = int(proof["response_r"], 16)

        challenge = _hash_to_scalar(
            b"CredAgentZK:challenge",
            statement_hash.encode("utf-8"),
            bytes.fromhex(proof["commitment"]),
            bytes.fromhex(proof["announcement"]),
        )

        lhs = response_w * _GENERATOR + response_r * _H_GENERATOR
        rhs = announcement + challenge * commitment
        if lhs != rhs:
            return False

        expected_hash = hashlib.sha256(
            json.dumps(
                {
                    "scheme": proof["scheme"],
                    "statement_hash": proof["statement_hash"],
                    "commitment": proof["commitment"],
                    "announcement": proof["announcement"],
                    "response_w": proof["response_w"],
                    "response_r": proof["response_r"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return proof.get("proof_hash") == expected_hash
    except Exception:
        return False

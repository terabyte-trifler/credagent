"""
Compatibility smoke tests for the current Phase 2A credit pipeline.

The comprehensive coverage lives in tests/test_all.py. This file keeps a
lighter-weight integration pass so older CI targets still exercise the
end-to-end pipeline without depending on the previous dataclass-based API.
"""

from features import FEATURE_NAMES, extract_features, extract_features_demo, validate_features
from model import MODEL_VERSION, get_model_hash, predict_default_probability
from scoring import MAX_SCORE, MIN_SCORE, classify_risk_tier, compute_credit_score
from app import app
from oracle_push import build_update_score_data, push_score_onchain


VALID_ADDR = "11111111111111111111111111111111"
VALID_ADDR_2 = "So11111111111111111111111111111112"


def test_demo_features_are_deterministic():
    first = extract_features_demo(VALID_ADDR)
    second = extract_features_demo(VALID_ADDR)
    assert first == second
    assert len(first) == len(FEATURE_NAMES) == 14


def test_demo_features_differ_across_addresses():
    first = extract_features_demo(VALID_ADDR)
    second = extract_features_demo(VALID_ADDR_2)
    assert first != second


def test_credit_score_output_shape():
    features = extract_features_demo(VALID_ADDR)
    result = compute_credit_score(features, default_probability=0.15)
    assert MIN_SCORE <= result["score"] <= MAX_SCORE
    assert result["risk_tier"] in {"AAA", "AA", "A", "BB", "C"}
    assert set(result["components"]).issubset(
        {"payment_history", "credit_utilization", "history_length", "protocol_diversity", "new_credit"}
    )


def test_higher_pd_means_lower_score():
    features = extract_features_demo(VALID_ADDR)
    safer = compute_credit_score(features, default_probability=0.02)
    riskier = compute_credit_score(features, default_probability=0.75)
    assert safer["score"] > riskier["score"]


def test_predict_default_probability_bounds():
    vector = list(validate_features(extract_features_demo(VALID_ADDR)).values())
    prob = predict_default_probability(__import__("numpy").array(vector))
    assert 0.001 <= prob <= 0.999


def test_risk_tier_boundaries():
    assert classify_risk_tier(850) == ("AAA", 4)
    assert classify_risk_tier(700) == ("AA", 3)
    assert classify_risk_tier(600) == ("A", 2)
    assert classify_risk_tier(500) == ("BB", 1)
    assert classify_risk_tier(400) == ("C", 0)


def test_score_endpoint():
    client = app.test_client()
    resp = client.post("/score", json={"address": VALID_ADDR})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["model_version"] == MODEL_VERSION
    assert data["model_hash"] == get_model_hash()
    assert MIN_SCORE <= data["score"] <= MAX_SCORE
    assert data["extraction_mode"] == "demo"
    assert data["zk_proof_status"] == "verified"
    assert data["zk_proof_scheme"] == "pedersen-schnorr-secp256k1-v1"
    assert len(data["zk_proof_hash"]) == 64
    assert isinstance(data["zk_proof"], dict)


def test_batch_endpoint():
    client = app.test_client()
    resp = client.post("/score/batch", json={"addresses": [VALID_ADDR, VALID_ADDR_2]})
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["count"] == 2
    assert len(payload["scores"]) == 2
    assert all(row["extraction_mode"] == "demo" for row in payload["scores"])
    assert all(row["zk_proof_status"] == "verified" for row in payload["scores"])


def test_model_info_endpoint():
    client = app.test_client()
    resp = client.get("/model/info")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["model_version"] == MODEL_VERSION
    assert data["model_hash"] == get_model_hash()
    assert len(data["feature_names"]) == 14


def test_oracle_instruction_data_shape():
    score_result = {
        "address": VALID_ADDR,
        "score": 720,
        "confidence": 85,
        "risk_tier_num": 3,
        "model_hash": get_model_hash(),
        "computed_at": 1711111111,
        "features": {"tx_count_90d": 12},
    }
    tx_data = build_update_score_data(score_result)
    assert tx_data["score"] == 720
    assert len(tx_data["model_hash"]) == 32
    assert len(tx_data["zk_proof_hash"]) == 32
    assert any(tx_data["zk_proof_hash"])


def test_oracle_push_dry_run():
    tx_data = {
        "borrower": VALID_ADDR,
        "score": 720,
        "confidence": 85,
        "risk_tier": 3,
    }
    result = push_score_onchain(tx_data, dry_run=True)
    assert result["status"] == "dry_run"
    assert result["score"] == 720
    assert len(result["tx_hash"]) == 64


def test_auto_extract_uses_demo_fallback():
    features, mode = extract_features(VALID_ADDR_2, mode="auto", rpc_url="http://127.0.0.1:1")
    assert mode == "demo"
    assert len(features) == 14


def test_verify_proof_endpoint():
    client = app.test_client()
    score_resp = client.post("/score", json={"address": VALID_ADDR})
    payload = score_resp.get_json()
    verify_resp = client.post(
        "/verify-proof",
        json={
            "address": payload["address"],
            "score": payload["score"],
            "computed_at": payload["computed_at"],
            "model_hash": payload["model_hash"],
            "zk_proof": payload["zk_proof"],
        },
    )
    assert verify_resp.status_code == 200
    assert verify_resp.get_json()["verified"] is True

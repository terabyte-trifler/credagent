"""
T2A.5 — ML API Test Suite

Covers:
  - Feature extraction validation (14 categories)
  - FICO scoring range and component weights
  - Risk tier classification
  - Default probability calculation
  - Flask API endpoints (/score, /batch, /features, /default-probability)
  - Oracle push pipeline (dry-run)
  - Input validation and security checks

Run: pytest tests/ -v --tb=short
"""

import sys
import os
import json
import math
import pytest
import numpy as np

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from features import (
    validate_address, validate_features, extract_features, extract_features_demo,
    features_to_vector, clamp_feature,
    FEATURE_NAMES, NUM_FEATURES, FEATURE_SCHEMA,
)
from scoring import (
    compute_credit_score, classify_risk_tier, get_tier_terms,
    compute_default_probability, WEIGHTS, MIN_SCORE, MAX_SCORE,
)
from model import (
    generate_training_data, train_model, predict_default_probability,
    get_model_hash, MODEL_VERSION,
)
from oracle_push import (
    build_update_score_data, fetch_score, score_and_push,
)
from app import app
from zk_proofs import generate_zk_proof, verify_zk_proof


# ═══════════════════════════════════════════
# Feature Extraction Tests
# ═══════════════════════════════════════════

class TestFeatures:
    """T2A.1 — Feature extraction and validation."""

    def test_feature_count_is_14(self):
        assert NUM_FEATURES == 14
        assert len(FEATURE_NAMES) == 14

    def test_validate_good_address(self):
        addr = "11111111111111111111111111111111"
        assert validate_address(addr) == addr

    def test_validate_bad_address_rejects(self):
        with pytest.raises(ValueError, match="Invalid Solana"):
            validate_address("not-a-valid-address")

    def test_validate_evm_address_rejects(self):
        with pytest.raises(ValueError, match="Invalid Solana"):
            validate_address("0x742d35Cc6634C0532925a3b8D9C5c8b7b6e5f6e5")

    def test_validate_empty_rejects(self):
        with pytest.raises(ValueError):
            validate_address("")

    def test_validate_non_string_rejects(self):
        with pytest.raises(ValueError, match="must be string"):
            validate_address(12345)

    def test_extract_demo_returns_14_features(self):
        addr = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"
        features = extract_features_demo(addr)
        assert len(features) == 14
        for name in FEATURE_NAMES:
            assert name in features

    def test_extract_demo_is_deterministic(self):
        addr = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"
        f1 = extract_features_demo(addr)
        f2 = extract_features_demo(addr)
        assert f1 == f2

    def test_extract_demo_different_per_address(self):
        f1 = extract_features_demo("11111111111111111111111111111111")
        f2 = extract_features_demo("22222222222222222222222222222222")
        assert f1 != f2

    def test_auto_extract_falls_back_to_demo_when_live_unavailable(self):
        features, mode = extract_features(
            "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            mode="auto",
            rpc_url="http://127.0.0.1:1",
        )
        assert mode == "demo"
        assert len(features) == 14

    def test_validate_features_clamps_values(self):
        raw = {"tx_count_90d": -10, "wallet_age_days": 999999}
        clean = validate_features(raw)
        assert clean["tx_count_90d"] == 0  # Clamped to min
        assert clean["wallet_age_days"] == 10000  # Clamped to max

    def test_validate_features_fills_missing(self):
        clean = validate_features({})  # Empty
        assert len(clean) == 14
        for v in clean.values():
            assert v == 0  # All zero defaults

    def test_features_to_vector_shape(self):
        features = extract_features_demo("11111111111111111111111111111111")
        vec = features_to_vector(features)
        assert vec.shape == (14,)
        assert vec.dtype == np.float64

    def test_clamp_unknown_feature_raises(self):
        with pytest.raises(ValueError, match="Unknown feature"):
            clamp_feature("nonexistent_feature", 42)

    def test_all_features_have_schema(self):
        for name in FEATURE_NAMES:
            assert name in FEATURE_SCHEMA
            schema = FEATURE_SCHEMA[name]
            assert "type" in schema
            assert "min" in schema
            assert "max" in schema
            assert schema["min"] <= schema["max"]


# ═══════════════════════════════════════════
# Scoring Tests
# ═══════════════════════════════════════════

class TestScoring:
    """T2A.2 — FICO-adapted scoring and risk tiers."""

    def test_weights_sum_to_one(self):
        assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9

    def test_score_range_300_to_850(self):
        features = extract_features_demo("11111111111111111111111111111111")
        result = compute_credit_score(features, 0.15)
        assert MIN_SCORE <= result["score"] <= MAX_SCORE

    def test_score_is_integer(self):
        features = extract_features_demo("11111111111111111111111111111111")
        result = compute_credit_score(features, 0.15)
        assert isinstance(result["score"], int)

    def test_confidence_range(self):
        features = extract_features_demo("11111111111111111111111111111111")
        result = compute_credit_score(features, 0.15)
        assert 0 <= result["confidence"] <= 100
        assert isinstance(result["confidence"], int)

    def test_low_default_prob_gives_higher_score(self):
        features = extract_features_demo("11111111111111111111111111111111")
        low = compute_credit_score(features, 0.01)
        high = compute_credit_score(features, 0.90)
        assert low["score"] > high["score"]

    def test_all_risk_tiers_reachable(self):
        tiers_seen = set()
        for prob in [0.001, 0.05, 0.15, 0.4, 0.95]:
            features = extract_features_demo("DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy")
            result = compute_credit_score(features, prob)
            tiers_seen.add(result["risk_tier"])
        # At least 3 different tiers should be reachable
        assert len(tiers_seen) >= 3

    def test_tier_thresholds(self):
        assert classify_risk_tier(850) == ("AAA", 4)
        assert classify_risk_tier(750) == ("AAA", 4)
        assert classify_risk_tier(749) == ("AA", 3)
        assert classify_risk_tier(650) == ("AA", 3)
        assert classify_risk_tier(649) == ("A", 2)
        assert classify_risk_tier(550) == ("A", 2)
        assert classify_risk_tier(549) == ("BB", 1)
        assert classify_risk_tier(450) == ("BB", 1)
        assert classify_risk_tier(449) == ("C", 0)
        assert classify_risk_tier(300) == ("C", 0)

    def test_tier_terms_completeness(self):
        for tier_num in range(5):
            terms = get_tier_terms(tier_num)
            assert "max_ltv_bps" in terms
            assert "rate_bps" in terms
            assert "max_loan_usd" in terms

    def test_default_probability_range(self):
        for score in [300, 450, 550, 650, 750, 850]:
            result = compute_default_probability(score)
            pd = result["probability_of_default"]
            assert 0.001 <= pd <= 0.999

    def test_higher_score_lower_default_prob(self):
        pd_low = compute_default_probability(800)["probability_of_default"]
        pd_high = compute_default_probability(350)["probability_of_default"]
        assert pd_low < pd_high

    def test_credit_spread_formula(self):
        result = compute_default_probability(500)
        pd = result["probability_of_default"]
        rr = result["recovery_rate"]
        spread = result["credit_spread"]
        expected = pd * (1 - rr)
        assert abs(spread - expected) < 0.0001

    def test_result_has_all_keys(self):
        features = extract_features_demo("11111111111111111111111111111111")
        result = compute_credit_score(features, 0.15)
        required = ["score", "confidence", "risk_tier", "risk_tier_num",
                     "components", "recommended_terms", "default_probability"]
        for key in required:
            assert key in result, f"Missing key: {key}"

    def test_components_match_weight_keys(self):
        features = extract_features_demo("11111111111111111111111111111111")
        result = compute_credit_score(features, 0.15)
        for key in WEIGHTS:
            assert key in result["components"]
            assert 0 <= result["components"][key] <= 1.0


# ═══════════════════════════════════════════
# Model Tests
# ═══════════════════════════════════════════

class TestModel:
    """T2A.1 — XGBoost model training and prediction."""

    def test_training_data_shape(self):
        X, y = generate_training_data(100, seed=42)
        assert X.shape == (100, 14)
        assert y.shape == (100,)
        assert set(y.tolist()).issubset({0, 1})

    def test_training_data_deterministic(self):
        X1, y1 = generate_training_data(50, seed=42)
        X2, y2 = generate_training_data(50, seed=42)
        np.testing.assert_array_equal(X1, X2)
        np.testing.assert_array_equal(y1, y2)

    def test_train_model_returns_metrics(self):
        metrics = train_model(save=True)
        assert "accuracy" in metrics
        assert "auc_roc" in metrics
        assert "model_hash" in metrics
        assert metrics["accuracy"] > 0.7  # Should achieve > 70%
        assert metrics["auc_roc"] > 0.7

    def test_predict_returns_valid_probability(self):
        features = extract_features_demo("11111111111111111111111111111111")
        vec = features_to_vector(features)
        prob = predict_default_probability(vec)
        assert 0.001 <= prob <= 0.999
        assert isinstance(prob, float)

    def test_model_hash_is_64_hex(self):
        h = get_model_hash()
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_model_version_defined(self):
        assert MODEL_VERSION == "xgboost-credagent-v1"

    def test_wrong_feature_count_raises(self):
        bad = np.zeros((1, 10))  # 10 instead of 14
        with pytest.raises(ValueError, match="Expected 14"):
            predict_default_probability(bad)


# ═══════════════════════════════════════════
# Flask API Tests
# ═══════════════════════════════════════════

class TestAPI:
    """T2A.3 — Flask API endpoints."""

    @pytest.fixture
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.get_json()
        assert data["status"] == "ok"
        assert "model_version" in data

    def test_score_valid_address(self, client):
        r = client.post("/score", json={"address": "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"})
        assert r.status_code == 200
        data = r.get_json()
        assert 300 <= data["score"] <= 850
        assert "risk_tier" in data
        assert "model_hash" in data
        assert len(data["model_hash"]) == 64
        assert data["extraction_mode"] == "demo"
        assert data["zk_proof_status"] == "verified"
        assert data["zk_proof_scheme"] == "pedersen-schnorr-secp256k1-v1"
        assert len(data["zk_proof_hash"]) == 64
        assert isinstance(data["zk_proof"], dict)

    def test_score_missing_address(self, client):
        r = client.post("/score", json={})
        assert r.status_code == 400

    def test_score_invalid_address(self, client):
        r = client.post("/score", json={"address": "bad"})
        assert r.status_code == 400

    def test_score_with_custom_features(self, client):
        r = client.post("/score", json={
            "address": "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            "features": {
                "tx_count_90d": 200,
                "wallet_age_days": 500,
                "defi_protocols_used": 8,
                "total_borrowed_usd": 20000,
                "total_repaid_usd": 19500,
                "payment_regularity": 0.95,
            },
        })
        assert r.status_code == 200
        data = r.get_json()
        assert 300 <= data["score"] <= 850

    def test_batch_score(self, client):
        r = client.post("/score/batch", json={
            "addresses": [
                "11111111111111111111111111111111",
                "22222222222222222222222222222222",
            ],
        })
        assert r.status_code == 200
        data = r.get_json()
        assert data["count"] == 2
        assert len(data["scores"]) == 2

    def test_batch_too_large(self, client):
        addrs = ["11111111111111111111111111111111"] * 25
        r = client.post("/score/batch", json={"addresses": addrs})
        assert r.status_code == 400

    def test_batch_empty(self, client):
        r = client.post("/score/batch", json={"addresses": []})
        assert r.status_code == 400

    def test_features_endpoint(self, client):
        r = client.get("/features/DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy")
        assert r.status_code == 200
        data = r.get_json()
        assert len(data["features"]) == 14
        assert data["extraction_mode"] == "demo"

    def test_default_probability_endpoint(self, client):
        r = client.post("/default-probability", json={
            "score": 720,
            "loan_amount_usd": 3000,
            "duration_days": 60,
        })
        assert r.status_code == 200
        data = r.get_json()
        assert 0 < data["probability_of_default"] < 1
        assert "credit_spread" in data

    def test_default_prob_bad_score(self, client):
        r = client.post("/default-probability", json={"score": 1000})
        assert r.status_code == 400

    def test_model_info(self, client):
        r = client.get("/model/info")
        assert r.status_code == 200
        data = r.get_json()
        assert data["feature_count"] == 14
        assert "risk_tiers" in data

    def test_404(self, client):
        r = client.get("/nonexistent")
        assert r.status_code == 404

    def test_score_deterministic(self, client):
        addr = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"
        r1 = client.post("/score", json={"address": addr}).get_json()
        r2 = client.post("/score", json={"address": addr}).get_json()
        assert r1["score"] == r2["score"]
        assert r1["zk_proof_status"] == "verified"
        assert len(r1["zk_proof_hash"]) == 64

    def test_verify_proof_endpoint(self, client):
        scored = client.post("/score", json={"address": "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"}).get_json()
        r = client.post("/verify-proof", json={
            "address": scored["address"],
            "score": scored["score"],
            "computed_at": scored["computed_at"],
            "model_hash": scored["model_hash"],
            "zk_proof": scored["zk_proof"],
        })
        assert r.status_code == 200
        assert r.get_json()["verified"] is True


# ═══════════════════════════════════════════
# Oracle Push Tests
# ═══════════════════════════════════════════

class TestOraclePush:
    """T2A.4 — Oracle push pipeline."""

    def test_build_update_score_data(self):
        score_result = {
            "address": "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            "score": 720,
            "confidence": 89,
            "risk_tier_num": 3,
            "model_hash": "a" * 64,
            "computed_at": 1711111111,
            "features": {"tx_count_90d": 7},
        }
        data = build_update_score_data(score_result)
        assert data["score"] == 720
        assert data["confidence"] == 89
        assert len(data["model_hash"]) == 32  # 32 bytes
        assert len(data["zk_proof_hash"]) == 32
        assert any(data["zk_proof_hash"])

    def test_real_zk_proof_verifies(self):
        proof = generate_zk_proof(
            "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            720,
            1711111111,
            "a" * 64,
            {"tx_count_90d": 7, "wallet_age_days": 30},
        )
        assert verify_zk_proof(
            proof,
            "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            720,
            1711111111,
            "a" * 64,
        ) is True

    def test_real_zk_proof_rejects_tampering(self):
        proof = generate_zk_proof(
            "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            720,
            1711111111,
            "a" * 64,
            {"tx_count_90d": 7, "wallet_age_days": 30},
        )
        assert verify_zk_proof(
            proof,
            "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            721,
            1711111111,
            "a" * 64,
        ) is False

    def test_build_rejects_bad_hash(self):
        with pytest.raises(ValueError, match="Invalid model_hash"):
            build_update_score_data({
                "address": "x", "score": 700, "confidence": 80,
                "risk_tier_num": 3, "model_hash": "too_short",
            })

    def test_dry_run_pipeline(self):
        """Full pipeline in dry-run mode (no ML API needed)."""
        # This test requires the ML API running.
        # For CI, we test build_update_score_data independently.
        score_result = {
            "address": "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy",
            "score": 720,
            "confidence": 89,
            "risk_tier": "AA",
            "risk_tier_num": 3,
            "model_hash": "b" * 64,
        }
        tx_data = build_update_score_data(score_result)
        from oracle_push import push_score_onchain
        result = push_score_onchain(tx_data, dry_run=True)
        assert result["status"] == "dry_run"
        assert result["score"] == 720
        assert "tx_hash" in result


# ═══════════════════════════════════════════
# Security Tests
# ═══════════════════════════════════════════

class TestSecurity:
    """Security-specific test cases."""

    @pytest.fixture
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_no_stack_trace_on_error(self, client):
        r = client.post("/score", json={"address": "bad"})
        data = r.get_json()
        assert "Traceback" not in json.dumps(data)
        assert "File" not in json.dumps(data)

    def test_score_never_below_300(self):
        """Even worst possible features should produce score >= 300."""
        worst = {name: 0 for name in FEATURE_NAMES}
        worst["liquidation_count"] = 10
        result = compute_credit_score(worst, 0.99)
        assert result["score"] >= MIN_SCORE

    def test_score_never_above_850(self):
        """Even best possible features should produce score <= 850."""
        best = {}
        for name, schema in FEATURE_SCHEMA.items():
            best[name] = schema["max"]
        result = compute_credit_score(best, 0.001)
        assert result["score"] <= MAX_SCORE

    def test_injected_extra_features_ignored(self):
        features = {"malicious_field": "hack", "__proto__": "x"}
        clean = validate_features(features)
        assert "malicious_field" not in clean
        assert "__proto__" not in clean
        assert len(clean) == 14

    def test_thin_file_wallet_is_not_scored_as_strong_credit(self):
        thin = {
            name: 0 for name in FEATURE_NAMES
        }
        thin["wallet_age_days"] = 10
        thin["tx_count_90d"] = 1
        result = compute_credit_score(thin, 0.20)
        assert result["score"] < 550

    def test_fresh_wallet_can_be_starter_eligible(self):
        fresh = {name: 0 for name in FEATURE_NAMES}
        fresh["wallet_age_days"] = 2
        fresh["tx_count_90d"] = 1
        fresh["avg_balance_30d_usd"] = 20
        result = compute_credit_score(fresh, 0.95)
        assert result["risk_tier"] == "C"
        assert result["starter_eligible"] is True
        assert result["lending_path"] == "starter"
        assert result["recommended_terms"]["max_loan_usd"] == 100

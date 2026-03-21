from features import validate_features
from scoring import compute_credit_score


def test_score_shape():
    result = compute_credit_score(validate_features({"tx_volume_90d_usd": 40}), default_probability=0.15)
    assert "score" in result
    assert "risk_tier" in result

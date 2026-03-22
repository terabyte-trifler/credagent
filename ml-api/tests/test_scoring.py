from features import validate_features
from scoring import compute_credit_score


def test_score_shape():
    result = compute_credit_score(validate_features({"tx_volume_90d_usd": 40}), default_probability=0.15)
    assert "score" in result
    assert "risk_tier" in result
    assert "starter_eligible" in result
    assert "lending_path" in result


def test_fresh_wallet_gets_starter_path_not_full_credit():
    result = compute_credit_score(
        validate_features({
            "wallet_age_days": 3,
            "tx_count_90d": 1,
            "avg_balance_30d_usd": 25,
        }),
        default_probability=0.90,
    )
    assert result["risk_tier"] == "C"
    assert result["starter_eligible"] is True
    assert result["lending_path"] == "starter"
    assert result["recommended_terms"]["max_loan_usd"] == 100

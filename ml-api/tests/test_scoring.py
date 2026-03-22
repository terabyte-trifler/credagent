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


def test_protocol_repayment_history_improves_score_context():
    thin = validate_features({
        "wallet_age_days": 10,
        "tx_count_90d": 1,
        "avg_balance_30d_usd": 50,
    })
    repaying = validate_features({
        "wallet_age_days": 120,
        "tx_count_90d": 6,
        "defi_protocols_used": 1,
        "total_borrowed_usd": 100,
        "total_repaid_usd": 100,
        "payment_regularity": 1.0,
        "avg_balance_30d_usd": 150,
    })

    thin_score = compute_credit_score(thin, default_probability=0.90)
    repaying_score = compute_credit_score(repaying, default_probability=0.40)

    assert repaying_score["score"] > thin_score["score"]


def test_new_credit_component_moves_when_wallet_borrows():
    no_credit = compute_credit_score(validate_features({
        "wallet_age_days": 60,
        "tx_count_90d": 5,
        "avg_balance_30d_usd": 100,
    }), default_probability=0.50)

    borrowed = compute_credit_score(validate_features({
        "wallet_age_days": 60,
        "tx_count_90d": 5,
        "avg_balance_30d_usd": 100,
        "defi_protocols_used": 1,
        "total_borrowed_usd": 50,
    }), default_probability=0.50)

    assert borrowed["components"]["new_credit"] > no_credit["components"]["new_credit"]

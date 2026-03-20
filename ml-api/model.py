def score_address(features):
    activity = features.get("tx_volume_score", 0)
    score = 300 + min(activity * 5, 550)
    return {
        "score": int(score),
        "confidence": 80,
        "risk_tier": "B",
        "default_probability": 0.12,
    }

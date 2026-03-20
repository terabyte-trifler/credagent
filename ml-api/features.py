def extract_features(address):
    return {
        "address": address,
        "tx_volume_score": len(address) % 100,
        "wallet_age_days": 90,
        "protocol_diversity": 3,
    }

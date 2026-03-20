def push_score(address, score):
    return {
        "address": address,
        "score": score,
        "status": "pending-wdk-signature",
    }

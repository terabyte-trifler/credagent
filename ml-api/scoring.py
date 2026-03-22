"""
T2A.2 — FICO-Adapted Credit Scoring & Risk Tier Classification

Converts XGBoost default probability into a FICO-adapted score (300-850)
and assigns risk tiers with recommended loan terms.

Score Formula:
  raw_score = weighted_sum(5 FICO components) ∈ [0, 1]
  final_score = 300 + raw_score × 550 ∈ [300, 850]
  ml_adjustment = (0.5 - default_probability) × 100 (bonus/penalty from ML)
  score = clamp(final_score + ml_adjustment, 300, 850)

SECURITY:
- All scores clamped to [300, 850] — no out-of-range outputs
- Confidence derived from feature completeness (0-100%)
- Risk tiers are deterministic (pure function of score)
- No mutable global state — all functions are pure

AUDIT:
- Component weights sum to exactly 1.0 (verified in tests)
- Score is integer — no floating point leaks to on-chain storage
- Default probability and credit spread use exact formulas
"""

import math
from features import FEATURE_NAMES, validate_features

# ═══════════════════════════════════════════
# Score Constants
# ═══════════════════════════════════════════

MIN_SCORE = 300
MAX_SCORE = 850
SCORE_RANGE = MAX_SCORE - MIN_SCORE  # 550

# Risk tier thresholds (must match Solana program constants)
AAA_THRESHOLD = 750
AA_THRESHOLD  = 650
A_THRESHOLD   = 550
BB_THRESHOLD  = 450

# FICO component weights (sum = 1.0 exactly)
WEIGHTS = {
    "payment_history":     0.35,
    "credit_utilization":  0.30,
    "history_length":      0.15,
    "protocol_diversity":  0.10,
    "new_credit":          0.10,
}

# Verify weights sum to 1.0 at import time
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "FICO weights must sum to 1.0"

STARTER_TERMS = {
    "max_ltv_bps": 10000,
    "rate_bps": 1800,
    "max_loan_usd": 100,
    "max_duration_days": 14,
}


# ═══════════════════════════════════════════
# Component Scoring Functions
# Each returns a value in [0.0, 1.0]
# ═══════════════════════════════════════════

def _payment_history(f: dict) -> float:
    """
    35% weight. Based on repayment behavior and liquidation history.

    High repayment ratio + high regularity + zero liquidations = 1.0
    No history = 0.5 (neutral, not penalized for being new)
    """
    borrowed = f.get("total_borrowed_usd", 0)
    repaid   = f.get("total_repaid_usd", 0)
    liqs     = f.get("liquidation_count", 0)
    regularity = f.get("payment_regularity", 0)

    if borrowed <= 0:
        # Thin-file wallets should not score as if they had established repayment history.
        activity = min(f.get("tx_count_90d", 0) / 150, 1.0)
        age = min(f.get("wallet_age_days", 0) / 365, 1.0)
        protocol_presence = min(f.get("defi_protocols_used", 0) / 4, 1.0)
        return min(0.35, activity * 0.15 + age * 0.10 + protocol_presence * 0.10)

    repay_ratio = min(repaid / max(borrowed, 1), 1.0)
    liq_penalty = max(0.0, 1.0 - liqs * 0.2)  # -20% per liquidation

    return repay_ratio * 0.5 + regularity * 0.3 + liq_penalty * 0.2


def _credit_utilization(f: dict) -> float:
    """
    30% weight. Lower utilization = higher score (like FICO).

    outstanding / balance < 30% = best score
    No balance = 0.3 (low, can't assess)
    """
    balance    = f.get("avg_balance_30d_usd", 0)
    borrowed   = f.get("total_borrowed_usd", 0)
    repaid     = f.get("total_repaid_usd", 0)

    if balance <= 0:
        return 0.1

    outstanding = max(0, borrowed - repaid)
    utilization = outstanding / max(balance, 1)

    # FICO: lower utilization = better. Optimal is < 30%.
    return max(0.0, 1.0 - min(utilization, 2.0) / 2.0)


def _history_length(f: dict) -> float:
    """
    15% weight. Longer history = more trustworthy.

    < 30 days  = 0.1 (very new)
    30-90      = 0.3
    90-365     = 0.6
    365-730    = 0.8
    > 730      = 1.0
    """
    age = f.get("wallet_age_days", 0)

    if age < 30:   return 0.1
    if age < 90:   return 0.3
    if age < 365:  return 0.6
    if age < 730:  return 0.8
    return 1.0


def _protocol_diversity(f: dict) -> float:
    """
    10% weight. More protocol usage = more sophisticated borrower.
    """
    protocols  = f.get("defi_protocols_used", 0)
    governance = f.get("governance_votes", 0)
    tokens     = f.get("token_diversity", 0)

    protocol_score  = min(protocols / 10, 1.0)
    governance_score = min(governance / 5, 1.0)
    token_score     = min(tokens / 15, 1.0)

    return protocol_score * 0.5 + governance_score * 0.25 + token_score * 0.25


def _new_credit(f: dict) -> float:
    """
    10% weight. Recent activity and cross-chain presence.
    """
    tx_count    = f.get("tx_count_90d", 0)
    cross_chain = f.get("cross_chain_activity", 0)
    attestations = f.get("nft_attestations", 0)

    activity    = min(tx_count / 100, 1.0)
    chain_score = min(cross_chain / 5, 1.0)
    nft_score   = min(attestations / 3, 1.0)

    return activity * 0.5 + chain_score * 0.25 + nft_score * 0.25


# ═══════════════════════════════════════════
# Main Scoring Function
# ═══════════════════════════════════════════

def compute_credit_score(
    features: dict,
    default_probability: float = 0.15,
) -> dict:
    """
    Compute FICO-adapted credit score from features + ML default probability.

    Args:
        features: dict of 14 on-chain features (validated)
        default_probability: XGBoost predicted P(default) ∈ [0, 1]

    Returns:
        dict with: score, confidence, risk_tier, risk_tier_num,
                   components, recommended_terms, default_probability

    AUDIT:
    - Score is always int in [300, 850]
    - Confidence is int in [0, 100]
    - Pure function: no side effects, no mutable state
    """
    f = validate_features(features)

    # Compute 5 FICO components
    components = {
        "payment_history":    round(_payment_history(f), 4),
        "credit_utilization": round(_credit_utilization(f), 4),
        "history_length":     round(_history_length(f), 4),
        "protocol_diversity": round(_protocol_diversity(f), 4),
        "new_credit":         round(_new_credit(f), 4),
    }

    # Weighted sum → [0, 1]
    raw = sum(components[k] * WEIGHTS[k] for k in WEIGHTS)

    # Map to [300, 850]
    base_score = MIN_SCORE + raw * SCORE_RANGE

    # ML adjustment: lower default prob = bonus, higher = penalty
    # Neutral at 0.15 (average default rate). Range: [-50, +50]
    ml_adj = (0.15 - default_probability) * 333

    # AUDIT: Final score always clamped to [300, 850], always integer
    score = int(max(MIN_SCORE, min(MAX_SCORE, round(base_score + ml_adj))))

    # Confidence: how many features have non-zero values
    non_zero = sum(1 for v in f.values() if v and float(v) > 0)
    confidence = int(min(100, max(10, (non_zero / len(FEATURE_NAMES)) * 100)))

    # Risk tier
    risk_tier, risk_tier_num = classify_risk_tier(score)
    starter_eligible = is_starter_eligible(f, score, default_probability)
    lending_path = "starter" if risk_tier_num == 0 and starter_eligible else ("standard" if risk_tier_num > 0 else "denied")
    recommended_terms = STARTER_TERMS.copy() if lending_path == "starter" else get_tier_terms(risk_tier_num)

    return {
        "score": score,
        "confidence": confidence,
        "risk_tier": risk_tier,
        "risk_tier_num": risk_tier_num,
        "components": components,
        "default_probability": round(default_probability, 6),
        "recommended_terms": recommended_terms,
        "starter_eligible": starter_eligible,
        "lending_path": lending_path,
    }


# ═══════════════════════════════════════════
# Risk Tier Classification
# ═══════════════════════════════════════════

def classify_risk_tier(score: int) -> tuple:
    """
    Pure function: score → (tier_name, tier_num).

    AUDIT: Thresholds must match Solana program constants exactly.
    """
    if score >= AAA_THRESHOLD: return ("AAA", 4)
    if score >= AA_THRESHOLD:  return ("AA",  3)
    if score >= A_THRESHOLD:   return ("A",   2)
    if score >= BB_THRESHOLD:  return ("BB",  1)
    return ("C", 0)


def get_tier_terms(tier_num: int) -> dict:
    """
    Recommended loan terms per risk tier.

    AUDIT: Must match LendingPool program check_eligibility logic.
    """
    terms = {
        4: {"max_ltv_bps": 8000, "rate_bps": 400,  "max_loan_usd": 10000, "max_duration_days": 365},
        3: {"max_ltv_bps": 6000, "rate_bps": 650,  "max_loan_usd": 5000,  "max_duration_days": 180},
        2: {"max_ltv_bps": 4000, "rate_bps": 1000, "max_loan_usd": 2000,  "max_duration_days": 90},
        1: {"max_ltv_bps": 2500, "rate_bps": 1500, "max_loan_usd": 500,   "max_duration_days": 60},
        0: {"max_ltv_bps": 0,    "rate_bps": 0,    "max_loan_usd": 0,     "max_duration_days": 0},
    }
    return terms.get(tier_num, terms[0])


def is_starter_eligible(features: dict, score: int, default_probability: float) -> bool:
    """
    Allow tiny, short-duration starter loans for fresh wallets without negative history.

    This is intentionally separate from normal BB+ eligibility so thin-file wallets
    can be tested without being treated like established borrowers.
    """
    age = features.get("wallet_age_days", 0)
    tx_count = features.get("tx_count_90d", 0)
    borrowed = features.get("total_borrowed_usd", 0)
    repaid = features.get("total_repaid_usd", 0)
    liquidations = features.get("liquidation_count", 0)
    protocol_count = features.get("defi_protocols_used", 0)
    balance = features.get("avg_balance_30d_usd", 0)

    if score >= BB_THRESHOLD:
        return False
    if liquidations > 0:
        return False
    if borrowed > 0 or repaid > 0:
        return False
    if age > 45:
        return False
    if tx_count > 5:
        return False
    if default_probability >= 0.9995:
        return False

    # Some sign of a genuinely fresh user rather than an ancient inert program account.
    return age >= 0 and (age <= 7 or tx_count > 0 or protocol_count > 0 or balance > 0)


# ═══════════════════════════════════════════
# Default Probability & Credit Spread
# ═══════════════════════════════════════════

def compute_default_probability(
    score: int,
    loan_amount_usd: float = 1000,
    duration_days: int = 30,
) -> dict:
    """
    Estimate probability of default using logistic model.

    Formula: base_pd = 1 / (1 + exp((score - 500) / 100))
    Adjustments: +30% per $10K, +20% per year

    Credit spread: S = PD × (1 - Recovery Rate)

    AUDIT:
    - PD clamped to [0.001, 0.999]
    - Recovery rate fixed at 0.4 (industry standard)
    - Suggested rate = spread + 200 bps base margin
    """
    # Logistic base PD
    base_pd = 1.0 / (1.0 + math.exp((score - 500) / 100))

    # Amount factor: larger loans = higher risk
    amount_factor = min(loan_amount_usd / 10000, 2.0)

    # Duration factor: longer loans = higher risk
    duration_factor = min(duration_days / 365, 1.0)

    pd = base_pd * (1.0 + 0.3 * amount_factor) * (1.0 + 0.2 * duration_factor)
    pd = max(0.001, min(0.999, pd))

    # Credit spread
    recovery_rate = 0.4
    spread = pd * (1.0 - recovery_rate)

    # Risk-adjusted return: what the lender expects to earn
    base_margin = 0.02  # 2%
    expected_return = (1.0 - pd) * (spread + base_margin) - pd * (1.0 - recovery_rate)

    return {
        "probability_of_default": round(pd, 6),
        "credit_spread": round(spread, 6),
        "recovery_rate": recovery_rate,
        "suggested_rate_bps": int(spread * 10000 + 200),
        "risk_adjusted_return": round(expected_return, 6),
        "inputs": {
            "score": score,
            "loan_amount_usd": loan_amount_usd,
            "duration_days": duration_days,
        },
    }

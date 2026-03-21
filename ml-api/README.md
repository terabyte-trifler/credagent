# @credagent/ml-api

ML credit scoring pipeline for CredAgent autonomous lending protocol.

## Modules

| File | Phase | Description |
|------|-------|-------------|
| `features.py` | T2A.1 | 14-category on-chain feature extraction (19 features) |
| `model.py` | T2A.2 | XGBoost credit scoring + FICO-adapted 300–850 + risk tiers + PD model |
| `app.py` | T2A.3 | Flask API: /score, /batch, /features, /default-probability, /model/info |
| `oracle_push.py` | T2A.4 | ML API → WDK sign → push score to CreditScoreOracle PDA on Solana |
| `tests/` | T2A.5 | 50+ pytest test cases covering all modules |

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
# Start API
python app.py

# Score a single address
curl -X POST http://localhost:5001/score -H "Content-Type: application/json" \
  -d '{"address": "11111111111111111111111111111111"}'

# Push score on-chain
python oracle_push.py 11111111111111111111111111111111
```

## Test

```bash
source venv/bin/activate
pytest tests/ -v --tb=short
pytest tests/ -v --cov=. --cov-report=term-missing
```

## Security

- All addresses validated via base58 regex before processing
- Score output always clamped [300, 850]
- PD always bounded (0.001, 0.999)
- CORS restricted to configured origins
- Rate limiting: 60 req/min per IP
- No secrets in any API response
- Model hash included for on-chain verification

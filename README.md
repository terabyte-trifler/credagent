# CredAgent

CredAgent is an autonomous lending protocol on Solana with three Anchor programs, a WDK service layer, an ML credit-scoring API, OpenClaw agent skills, and a demo frontend.

## Workspace

- `programs/`: Anchor programs for scores, lending, and permissions
- `wdk-service/`: WDK wallet, bridge, and MCP bridge code
- `ml-api/`: Flask scoring service
- `agent/`: OpenClaw skills and config
- `frontend/`: dashboard and demo UI
- `tests/`: integration and security scenarios

## Getting Started

1. Copy `.env.example` to `.env`.
2. Install JS dependencies in `wdk-service/` and `frontend/`.
3. Create a Python virtualenv in `ml-api/` and install `requirements.txt`.
4. Run `anchor build` from the repo root.

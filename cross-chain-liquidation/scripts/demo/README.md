# Demo

This folder contains the end-to-end MVP demo flow output.

Current local demo:

- build the relayer demo runner: `npm run build` in `cross-chain-liquidation/apps/relayer`
- run the demo: `node dist/day9-local-demo.js` in `cross-chain-liquidation/apps/relayer`
- output summary: `cross-chain-liquidation/scripts/demo/day9-local-demo-output.json`

Current hardening demo:

- build the relayer demo runner: `npm run build` in `cross-chain-liquidation/apps/relayer`
- run the hardening demo: `node dist/day10-hardening-demo.js` in `cross-chain-liquidation/apps/relayer`
- output summary: `cross-chain-liquidation/scripts/demo/day10-hardening-output.json`

The Day 9 demo covers:

- Solana default event simulation
- relayer intent signing and submission to `LiquidationConfig`
- EVM config activation
- hook-controlled swap execution through the mock pool manager
- treasury and recovery receipt verification

The Day 10 hardening demo covers:

- unauthorized liquidator rejection
- expired intent rejection
- sell-cap overflow rejection

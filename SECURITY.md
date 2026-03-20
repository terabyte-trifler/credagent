# Security Checklist

- Keep agent seeds and wallet keypairs out of version control.
- Enforce program-owned escrow accounts for collateral custody.
- Use on-chain spending limits for agent actions.
- Preserve escrow state during emergency pause.
- Never expose private keys through WDK or MCP responses.
- Review liquidation, delegate pull, and pause flows before deploy.

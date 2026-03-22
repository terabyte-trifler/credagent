# Running CredAgent

CredAgent currently runs as three local processes:

1. MCP server in [`wdk-service`](/Users/terabyte_trifler/Documents/credagent/wdk-service)
2. ML API in [`ml-api`](/Users/terabyte_trifler/Documents/credagent/ml-api)
3. Dashboard in [`frontend`](/Users/terabyte_trifler/Documents/credagent/frontend)

OpenClaw connects to the MCP SSE endpoint exposed by the WDK service:

```bash
cd wdk-service
npm install
npm start
# http://127.0.0.1:3100/mcp
# http://127.0.0.1:3100/health
```

For localhost-only development, auth stays disabled by default when `MCP_HOST=127.0.0.1` and `MCP_API_KEYS` is unset.

If you expose the MCP server beyond localhost, auth is mandatory:

```bash
export MCP_HOST=0.0.0.0
export MCP_API_KEYS=openclaw-key-abc123def456,dashboard-key-xyz789
export MCP_CORS_ORIGINS=http://localhost:3000,https://credagent.app
export MCP_TOKEN_SECRET=<64-char-hex>
```

You can exchange an API key for a short-lived dashboard session token:

```bash
curl -X POST http://127.0.0.1:3100/auth/token \
  -H "Authorization: Bearer dashboard-key-xyz789"
```

Then use the returned `ses_...` token for protected MCP routes:

```bash
curl -X POST http://127.0.0.1:3100/mcp/call \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_balance","params":{"agent_id":"credit-agent"}}'
```

Start the ML API:

```bash
cd ml-api
source venv/bin/activate
python app.py
# http://127.0.0.1:5001/health
```

Start the dashboard:

```bash
cd frontend
npm install
npm run dev
# http://127.0.0.1:3000
```

Quick verification:

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3100/mcp/tools -H "Authorization: Bearer <api-key>"
curl http://127.0.0.1:5001/health
curl -X POST http://127.0.0.1:3100/mcp/call \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_balance","params":{"agent_id":"credit-agent"}}'
```

By default the MCP server binds to `127.0.0.1`. To expose it intentionally, set:

```bash
export MCP_HOST=0.0.0.0
```

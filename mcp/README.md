# MCP Server Setup

The `armalo-agent` MCP server exposes all agent tools to any MCP-compatible client, protected by Armalo's trust shield.

## Tools Exposed

| Tool | Description | Trust Required |
|------|-------------|----------------|
| `web_search` | Search the web for current information | 0+ |
| `fetch_url` | Fetch and read web page content | 0+ |
| `calculator` | Evaluate math expressions safely | 0+ |
| `run_code` | Execute JavaScript/TypeScript snippets | 700+ |
| `memory` | Store and retrieve session facts | 0+ |

## Add to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "armalo-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/armalo-agent/mcp/server.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "ARMALO_API_KEY": "armalo_sk_...",
        "ARMALO_AGENT_ID": "your-agent-id"
      }
    }
  }
}
```

## Run Standalone

```bash
# Start the MCP server
npm run mcp

# Or with custom trust threshold
MCP_MIN_TRUST_SCORE=600 npm run mcp
```

## How the Shield Works

```
MCP Client Request
  ↓
Injection Filter    ← Block prompt injection attempts
  ↓
Rate Limiter        ← Per-tool, per-caller limits
  ↓
Trust Score Gate    ← Fetch agent's Armalo trust score
  ↓  (block if below threshold)
Tool Execution
  ↓
Audit Log           ← Forward to Armalo for trust scoring
  ↓
MCP Client Response
```

## Shield Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `MCP_MIN_TRUST_SCORE` | `0` | Minimum trust score (0–1000) |
| `MCP_RATE_LIMIT` | `60` | Max calls per minute per caller |
| `ARMALO_API_KEY` | — | Enables trust-score gating + audit |
| `ARMALO_AGENT_ID` | — | Agent to gate against |

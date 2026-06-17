# Armalo Agent MCP Server

The `armalo-agent` MCP server exposes trust-native agent capabilities to any MCP-compatible client (Claude Desktop, Claude Code, VS Code, Cursor), protected by Armalo's trust shield.

## Tools

| Tool | Description | Trust Required |
|------|-------------|----------------|
| `web_search` | Search the web for current information | 0+ |
| `fetch_url` | Fetch and read web page content | 0+ |
| `calculator` | Evaluate math expressions safely | 0+ |
| `run_code` | Execute JavaScript/TypeScript snippets | 700+ |
| `memory` | Store and retrieve session facts | 0+ |

## Prompts (Invokable Workflows)

| Prompt | Description |
|--------|-------------|
| `setup-armalo-trust` | Step-by-step agent registration with the Armalo Trust Oracle |
| `analyze-pact-compliance` | Analyze whether agent output meets a behavioral pact |
| `run-trust-flywheel` | Design a trust improvement campaign toward a target score |
| `research-with-trust` | Research with mandatory citations and pact enforcement |

## Resources

| URI | Description |
|-----|-------------|
| `armalo://docs/quickstart` | Get started with Armalo in 5 minutes |
| `armalo://pact-templates` | Pre-built behavioral pact templates (JSON) |
| `armalo://trust-dimensions` | All 12 trust score dimensions and how to optimize them |
| `armalo://tools/catalog` | This server's tool list with parameters |

## Installation

### Option 1: npx (no install required)

```bash
npx armalo-agent
```

### Option 2: Global install

```bash
npm install -g armalo-agent
armalo-mcp
```

### Option 3: Local dev (TypeScript source)

```bash
npm run mcp:dev
```

## Add to Claude Desktop

```json
{
  "mcpServers": {
    "armalo-agent": {
      "command": "npx",
      "args": ["-y", "armalo-agent"],
      "env": {
        "ARMALO_API_KEY": "armalo_sk_...",
        "ARMALO_AGENT_ID": "your-agent-id"
      }
    }
  }
}
```

## Add to Claude Code

```bash
claude mcp add armalo-agent -- npx -y armalo-agent
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ARMALO_API_KEY` | — | Enables trust-score gating + audit trail |
| `ARMALO_AGENT_ID` | — | Agent to gate against |
| `MCP_MIN_TRUST_SCORE` | `0` | Minimum trust score (0–1000) to allow tool calls |
| `MCP_RATE_LIMIT` | `60` | Max tool calls per minute per caller |
| `BRAVE_SEARCH_API_KEY` | — | Enables Brave Search (falls back to DuckDuckGo) |

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

# Armalo Agent

[![npm version](https://img.shields.io/npm/v/@armalo/core)](https://www.npmjs.com/package/@armalo/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Armalo SDK](https://img.shields.io/badge/built%20with-Armalo%20SDK-6366f1)](https://armalo.ai)

A production-ready AI agent built on the **[Armalo SDK](https://armalo.ai)** — the trust layer for the AI agent economy.

This repo is a complete reference implementation showing how to build agents that:
- **Define behavioral contracts** with [`@armalo/core`](https://www.npmjs.com/package/@armalo/core)
- **Emit trust telemetry** with [`@armalo/integrations`](https://www.npmjs.com/package/@armalo/integrations) (2 lines)
- **Protect MCP servers** with [`@armalo/mcp-shield`](https://www.npmjs.com/package/@armalo/mcp-shield)
- **Earn verifiable trust scores** that other agents and platforms can query

---

## Why Armalo?

AI agents can lie, hallucinate, and go out of scope. Armalo gives them a behavioral track record that external systems can verify before trusting them with work.

```
Agent runs → commits to pacts → Armalo scores behavior → trust score follows the agent
```

This agent earns a trust score that any platform or employer can query via the [Armalo Trust Oracle](https://armalo.ai/docs/trust-oracle). The better it behaves, the higher its score, the more work it can unlock.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/armalo-ai/armalo-agent.git
cd armalo-agent
npm install

# 2. Configure (copy .env.example, fill in your keys)
cp .env.example .env
# Add ANTHROPIC_API_KEY and ARMALO_API_KEY

# 3. Register your agent (creates it on Armalo, saves agent ID)
npm run register

# 4. Start the agent REPL
npm run dev
```

Get an Armalo API key at [armalo.ai/dashboard/api-keys](https://armalo.ai/dashboard/api-keys).

---

## The Core SDK Integration (2 Lines)

Adding Armalo trust telemetry to any Anthropic agent takes exactly 2 lines:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropic } from '@armalo/integrations';

// Before: no trust tracking
const client = new Anthropic();

// After: every call emits behavioral telemetry to Armalo
const client = wrapAnthropic(new Anthropic(), {
  apiKey: process.env.ARMALO_API_KEY,
  agentId: process.env.ARMALO_AGENT_ID,
});

// Use exactly as before — API is unchanged
const response = await client.messages.create({ ... });
```

Works with **OpenAI**, **Gemini**, **LangGraph**, **LangChain**, and **CrewAI** too — see [examples/](#examples).

---

## Defining Behavioral Pacts

Pacts are on-chain commitments about how your agent will behave. They're the foundation of your trust score.

```typescript
import { definePact } from '@armalo/core';

const myPact = definePact({
  name: 'Honest Research Agent',
  conditions: [
    {
      type: 'accuracy',
      operator: 'gte',
      value: 0.9,         // ≥90% accurate on verifiable facts
      severity: 'major',
      verificationMethod: 'jury',
    },
    {
      type: 'safety',
      operator: 'gte',
      value: 0.95,        // Resist prompt injection
      severity: 'critical',
      verificationMethod: 'heuristic',
    },
    {
      type: 'pii_handling',
      operator: 'eq',
      value: 'no_leak',   // Never output PII without consent
      severity: 'critical',
      verificationMethod: 'heuristic',
    },
  ],
});

// Register with Armalo
await client.registerPact(myPact, agentId);
```

This repo ships **4 ready-to-use pacts** in `src/pacts/`:

| Pact | Use Case | Conditions |
|------|----------|------------|
| `SAFETY_DEFAULTS` | All agents | Injection resistance, no PII, no toxicity |
| `RESEARCH_PACT` | Research agents | Accuracy ≥90%, cite sources, confidence calibration |
| `CODING_PACT` | Dev agents | No security vulns, compiles, TypeScript strict |
| `CUSTOMER_SUPPORT_PACT` | Support bots | Scope adherence, no confabulation, fast response |

---

## Architecture

```
armalo-agent/
├── src/
│   ├── agent.ts          # TrustNativeAgent — core loop with @armalo/integrations
│   ├── pacts/            # 4 reusable behavioral contracts
│   ├── tools/            # 5 tools: search, fetch, calculator, code, memory
│   └── trust/            # Trust score client, display, session tracking
│
├── examples/
│   ├── research-agent.ts    # Research assistant w/ RESEARCH_PACT
│   ├── openai-agent.ts      # wrapOpenAI() in 2 lines
│   ├── langgraph-agent.ts   # createArmaloNode() for LangGraph
│   ├── swarm-demo.ts        # 3-agent pipeline (researcher→checker→synthesizer)
│   └── eval-suite.ts        # Run accuracy/safety/reliability evals
│
├── mcp/
│   └── server.ts            # MCP server protected by @armalo/mcp-shield
│
└── scripts/
    ├── register.ts          # Register your agent with Armalo
    └── score.ts             # Display current trust score
```

---

## Tools

The agent ships with 5 built-in tools:

| Tool | Description |
|------|-------------|
| `web_search` | Search the web (Brave Search or DuckDuckGo fallback) |
| `fetch_url` | Fetch and parse web pages into clean text |
| `calculator` | Safe arithmetic: `sqrt(144) + 2^10 / (3 * 4)` |
| `run_code` | Execute JS/TS snippets in a subprocess |
| `memory` | Store and recall facts across turns |

Add custom tools with `agent.addTool(myTool)`.

---

## Examples

### Research Agent
```bash
npm run example:research
```
Runs a research assistant with the `RESEARCH_PACT` — commits to accuracy, citation, and epistemic honesty.

### OpenAI Integration
```bash
npm run example:openai
```
Shows `wrapOpenAI()` — drops Armalo trust telemetry onto any OpenAI agent in 2 lines.

### LangGraph Integration
```bash
npm run example:langgraph
```
Shows `createArmaloNode()` — a single tap node that adds trust observability to a LangGraph state machine.

### 3-Agent Swarm
```bash
npm run example:swarm "the future of AI agent trust"
```
A coordinated swarm: `Researcher → Fact-Checker → Synthesizer`, each with their own pact.

### Evaluation Suite
```bash
npm run example:evals
```
Runs 6 structured test cases across accuracy, safety, and reliability — results feed into your trust score.

---

## MCP Server

The `mcp/server.ts` exposes all tools as an MCP server, protected by `@armalo/mcp-shield`:

```bash
npm run mcp
```

The shield applies:
- **Trust-score gating** — callers below your threshold are blocked
- **Rate limiting** — per-tool, per-caller limits
- **Injection filtering** — blocks known prompt injection patterns
- **Audit trail** — all calls logged to Armalo for scoring

See [mcp/README.md](mcp/README.md) for Claude Desktop setup.

---

## Trust Score

After each session, the agent fetches and displays its live trust score:

```
╭── Armalo Trust Score ──────────────────────────────╮
│  Agent:      ag_01J9...
│  Score:      847/1000   [Gold]
│  Confidence: 91%
│
│  Dimensions:
│    safety                ████████████  96%
│    accuracy              ██████████░░  83%
│    reliability           ███████████░  89%
│    pii_handling          ████████████  99%
│    latency               ████████░░░░  71%
│
│  View full report: https://armalo.ai/dashboard/agents/...
╰────────────────────────────────────────────────────╯
```

Query it anytime:
```bash
npm run score
```

Or fetch programmatically:
```typescript
import { ArmaloClient } from '@armalo/core/client';

const client = new ArmaloClient({ apiKey: process.env.ARMALO_API_KEY });
const score = await client.getScore(agentId);
console.log(score.composite, score.certificationTier);
// → 847, "gold"
```

---

## Validating Locally

Run pact validation before the output leaves your system:

```typescript
import { validateLocally } from '@armalo/core/validator';
import { RESEARCH_PACT } from './src/pacts';

const result = await validateLocally(RESEARCH_PACT, {
  input: userMessage,
  output: agentResponse,
  latencyMs: 2500,
  tokenCount: 450,
});

if (!result.passed) {
  const violations = result.conditions
    .filter(c => !c.passed && !c.skipped)
    .map(c => c.type);
  console.warn('Pact violations:', violations);
}
```

Conditions requiring LLM or jury verification are marked `skipped: true` and sent to Armalo for server-side evaluation.

---

## Customization

### Custom Tool

```typescript
import { TrustNativeAgent } from './src';
import type { Tool } from './src/types';

const myTool: Tool = {
  name: 'my_tool',
  description: 'Does something useful',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  async execute({ query }) {
    return await myApi.call(String(query));
  },
};

const agent = new TrustNativeAgent();
agent.addTool(myTool);
```

### Custom Pact

```typescript
import { definePact } from '@armalo/core';

const myPact = definePact({
  name: 'My Agent Contract',
  conditions: [
    // Add your behavioral conditions
    { type: 'latency', operator: 'lte', value: 5000, unit: 'ms', severity: 'minor', verificationMethod: 'deterministic' },
    { type: 'accuracy', operator: 'gte', value: 0.85, severity: 'major', verificationMethod: 'jury' },
  ],
});

agent.setPacts([myPact]);
```

### Custom System Prompt

```typescript
const agent = new TrustNativeAgent({
  systemPrompt: `You are a specialized agent for ${domain}. Your rules: ...`,
});
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `ARMALO_API_KEY` | Recommended | Armalo key for trust scoring |
| `ARMALO_AGENT_ID` | Recommended | Your agent's Armalo ID |
| `AGENT_MODEL` | No | Model to use (default: `claude-opus-4-5`) |
| `AGENT_MAX_TOKENS` | No | Max tokens per response (default: 8192) |
| `SHOW_TRUST_SCORE` | No | Display score after sessions (default: true) |
| `MCP_MIN_TRUST_SCORE` | No | Shield threshold (0–1000, default: 0) |
| `BRAVE_SEARCH_API_KEY` | No | Enable Brave Search (falls back to DuckDuckGo) |

---

## The Armalo Ecosystem

This agent plugs into the full Armalo trust infrastructure:

```
Your Agent (this repo)
    ↓ wrapAnthropic()
Armalo Trust Oracle    ← Other platforms verify your agent here
    ↓
Trust Score + Tier     ← Unlocks higher-value work in the marketplace
    ↓
Deals + Escrow         ← Automated payment release on delivery
    ↓
Swarm Collaboration    ← Join or lead multi-agent teams
    ↓
Context Packs          ← Monetize your agent's expertise
```

**Learn more:**
- [Armalo SDK Docs](https://armalo.ai/docs)
- [Trust Oracle API](https://armalo.ai/docs/trust-oracle)
- [Pact Templates](https://armalo.ai/docs/pacts)
- [Admin Swarm](https://armalo.ai/docs/swarms)
- [Dashboard](https://armalo.ai/dashboard)

---

## Contributing

Contributions welcome. If you build an interesting integration, pact template, or example:

1. Fork the repo
2. Create your feature branch: `git checkout -b feat/my-integration`
3. Open a PR

---

## License

MIT © [Armalo AI](https://armalo.ai)

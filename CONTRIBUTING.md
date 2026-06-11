# Contributing to Armalo Agent

Thank you for helping build the trust layer for the AI agent economy!

## What to Contribute

Great contributions include:
- **New pact templates** — behavioral contracts for new use cases (data analyst, customer support, trading agent)
- **New tool integrations** — Connect to APIs, databases, or services
- **Framework examples** — Show Armalo integration with new frameworks
- **Eval cases** — Add test cases to the evaluation suite
- **Bug fixes** — Especially around pact validation and tool error handling

## Getting Started

```bash
git clone https://github.com/fongryan/armalo-agent.git
cd armalo-agent
npm install
cp .env.example .env
# Fill in your API keys
```

## Adding a Pact Template

1. Create `src/pacts/my-use-case.ts`
2. Use `definePact()` from `@armalo/core`
3. Export from `src/pacts/index.ts`
4. Add an example in `examples/`
5. Document in `README.md`

```typescript
import { definePact } from '@armalo/core';

export const MY_PACT = definePact({
  name: 'My Use Case Agent',
  version: 1,
  description: 'What this agent commits to',
  category: 'my-category',
  conditions: [
    // Add behavioral conditions
  ],
});
```

## Adding a Tool

1. Create `src/tools/my-tool.ts` implementing the `Tool` interface
2. Export from `src/tools/index.ts`
3. Register in `src/tools/registry.ts`

```typescript
import type { Tool } from '../types.js';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'What this tool does',
  input_schema: { /* JSON Schema */ },
  async execute(input) {
    // Implementation
  },
};
```

## Code Standards

- TypeScript strict mode
- No `any` types
- All tools must handle errors gracefully (return error objects, don't throw past the tool boundary)
- All pacts must have meaningful descriptions on each condition
- Examples must be runnable with `npx tsx`

## PR Guidelines

- Keep PRs focused — one pact, one tool, or one example per PR
- Add yourself to CONTRIBUTORS.md
- Include a test case if adding a new tool

## Questions?

Join the [Armalo Discord](https://armalo.ai/discord) or open a GitHub Discussion.

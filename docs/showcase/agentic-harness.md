# Armalo Agent OSS Showcase

This repo is designed to be a free, inspectable reference for trust-native agent engineering. It should show more than a chat loop: it should show provider control, harness discipline, verification evidence, reusable skills, and shareable proof.

## What This Adds

1. **Run receipts**
   - JSON-native proof objects for agent work.
   - Markdown and HTML renderers for sharing.
   - Verification status derived from attached evidence, not claims.

2. **Provider router**
   - Provider-agnostic failover for Anthropic-compatible inference clients.
   - Records every provider attempt with latency and error attribution.
   - Keeps Armalo positioned as the trust layer over any model path.

3. **Coding harness**
   - A spec -> plan -> patch -> verify loop.
   - Fails closed when verification commands fail.
   - Emits receipts with test and diff evidence.

4. **Agent gauntlet**
   - Public scorecards for coding, research, safety, tool honesty, and provider-failover tasks.
   - Produces receipt-backed scores instead of informal demo output.

5. **Skill packs**
   - Curated capability bundles for coding, security, research, marketplace providers, and MCP Shield.
   - Each pack names pacts, tools, eval tasks, and receipt types so users can compose serious agents quickly.

## Try It

```bash
npm install
npm run example:showcase
npm test
```

The showcase path does not require paid model keys. It uses deterministic demo clients so users can inspect the architecture first, then swap in real providers.

## Design Principle

The repo should never require users to trust a screenshot or a vague "agent completed" message. Every important run should answer:

- What was the agent asked to do?
- Which provider path did it use?
- Which tools did it call?
- What evidence proves the result?
- Which pacts or skill pack governed the work?
- What failed, if anything?

That proof-first loop is the Armalo differentiator.

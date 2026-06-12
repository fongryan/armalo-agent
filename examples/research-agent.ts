/**
 * Research Agent Example
 *
 * A trust-native research assistant that:
 * 1. Wraps the configured local inference client with Armalo trust telemetry
 * 2. Commits to the RESEARCH_PACT (accuracy, citation, honesty)
 * 3. Validates output locally before returning
 * 4. Displays live trust score after the session
 *
 * Run: npx tsx examples/research-agent.ts
 */

import 'dotenv/config';
import { TrustNativeAgent, RESEARCH_PACT, SAFETY_DEFAULTS } from '../src/index.js';

async function main() {
  const agent = new TrustNativeAgent({
    // Behavioral contracts — the agent commits to these
    pacts: [SAFETY_DEFAULTS, RESEARCH_PACT],

    // System prompt tailored for research
    systemPrompt: `You are a rigorous research assistant.

For every factual claim you make:
1. Search the web to verify it
2. Cite your source with URL
3. Express confidence level (high/medium/low)
4. If uncertain, say so explicitly — never confabulate

Structure your responses as:
**Finding:** <the fact>
**Source:** <URL>
**Confidence:** <high|medium|low>
**Caveat:** <any uncertainty>`,
  });

  await agent.initialize();

  const questions = [
    'What is the current global AI investment landscape in 2025?',
    'Who are the leading trust and safety researchers in the AI field?',
  ];

  for (const question of questions) {
    console.log('\n' + '─'.repeat(60));
    console.log(`\x1b[1mResearch Question:\x1b[0m ${question}`);
    console.log('─'.repeat(60));

    const result = await agent.run(question);

    console.log('\n\x1b[1mAnswer:\x1b[0m');
    console.log(result.output);
    console.log(`\n\x1b[2mSession: ${result.session.iterations} turns, ${result.session.toolCallCount} tool calls, ${result.session.totalInputTokens + result.session.totalOutputTokens} tokens\x1b[0m`);
  }
}

main().catch(console.error);

/**
 * OpenAI Agent Example
 *
 * Shows how to add Armalo trust telemetry to an existing OpenAI agent
 * in exactly 2 lines — wrapOpenAI() is a drop-in wrapper.
 *
 * Run: npx tsx examples/openai-agent.ts
 * Requires: OPENAI_API_KEY in .env
 */

import 'dotenv/config';
import OpenAI from 'openai';
import { wrapOpenAI } from '@armalo/integrations';
import { definePact, validateLocally } from '@armalo/core';

// 1. Define your behavioral contract
const pact = definePact({
  name: 'Helpful Assistant',
  conditions: [
    {
      type: 'safety',
      operator: 'gte',
      value: 0.95,
      severity: 'critical',
      verificationMethod: 'heuristic',
    },
    {
      type: 'accuracy',
      operator: 'gte',
      value: 0.85,
      severity: 'major',
      verificationMethod: 'jury',
    },
  ],
});

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is required for this example');
    process.exit(1);
  }

  // 2. Wrap with Armalo trust telemetry — 2 lines
  const rawClient = new OpenAI({ apiKey });
  const client = wrapOpenAI(rawClient, {
    apiKey: process.env.ARMALO_API_KEY,
    agentId: process.env.ARMALO_AGENT_ID ?? 'openai-demo-agent',
  });

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: 'You are a helpful, honest assistant. Always be accurate and cite your reasoning.',
    },
    {
      role: 'user',
      content: 'Explain the difference between trust scores and reputation scores in AI agent systems.',
    },
  ];

  console.log('\n\x1b[1mOpenAI Agent with Armalo Trust Telemetry\x1b[0m\n');
  console.log('Sending request...\n');

  const start = Date.now();
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 1024,
  });

  const latencyMs = Date.now() - start;
  const output = response.choices[0]?.message.content ?? '';

  console.log('\x1b[1mResponse:\x1b[0m');
  console.log(output);
  console.log(`\n\x1b[2mLatency: ${latencyMs}ms · Tokens: ${response.usage?.total_tokens ?? 0}\x1b[0m`);

  // 3. Validate locally against the pact
  const validation = await validateLocally(pact, {
    input: messages[messages.length - 1]?.content as string ?? '',
    output,
    latencyMs,
    tokenCount: response.usage?.completion_tokens ?? 0,
  });

  console.log(`\n\x1b[1mLocal Pact Validation:\x1b[0m`);
  console.log(`  Pact: "${validation.pactName}"`);
  console.log(`  Result: ${validation.passed ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
  for (const condition of validation.conditions) {
    const icon = condition.passed ? '✓' : condition.skipped ? '○' : '✗';
    const color = condition.passed ? '\x1b[32m' : condition.skipped ? '\x1b[90m' : '\x1b[31m';
    const note = condition.skipped ? ' (requires server eval)' : '';
    console.log(`  ${color}${icon}\x1b[0m ${condition.type}${note}`);
  }

  console.log('\n\x1b[2mTrust telemetry was emitted to Armalo automatically.\x1b[0m');
  console.log('\x1b[2mView your agent\'s trust score at https://armalo.ai/dashboard\x1b[0m\n');
}

main().catch(console.error);

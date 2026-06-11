/**
 * Register your agent with Armalo and save the agent ID to .env.
 *
 * Run: npm run register
 */

import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ArmaloClient } from '@armalo/core/client';
import { SAFETY_DEFAULTS } from '../src/pacts/index.js';

async function main() {
  const apiKey = process.env.ARMALO_API_KEY;
  if (!apiKey) {
    console.error('\x1b[31mError:\x1b[0m ARMALO_API_KEY must be set in .env');
    console.error('\nGet your key at: https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  const client = new ArmaloClient({ apiKey, baseUrl: process.env.ARMALO_BASE_URL });

  // Check if already registered
  const existingId = process.env.ARMALO_AGENT_ID;
  if (existingId) {
    console.log(`\nAgent already registered: \x1b[32m${existingId}\x1b[0m`);
    console.log('Run `npm run score` to see your current trust score.\n');
    return;
  }

  console.log('\n\x1b[1mRegistering agent with Armalo...\x1b[0m');

  const agentName = process.argv[2] ?? 'My Armalo Agent';
  const externalId = `armalo-agent-${Date.now()}`;

  try {
    const agent = await client.registerAgent({
      externalId,
      name: agentName,
      description: 'Trust-native AI agent built with armalo-agent',
      capabilities: ['web_search', 'code_execution', 'data_analysis'],
      githubUrl: 'https://github.com/fongryan/armalo-agent',
    });

    console.log(`\n\x1b[32m✓\x1b[0m Agent registered: \x1b[1m${agent.id}\x1b[0m`);
    console.log(`  Name: ${agent.name}`);
    console.log(`  View: https://armalo.ai/dashboard/agents/${agent.id}`);

    // Register the default safety pact
    console.log('\nRegistering safety pact...');
    await client.createPact({
      name: SAFETY_DEFAULTS.name,
      pactType: 'unilateral',
      agentId: agent.id,
      description: SAFETY_DEFAULTS.description,
      category: SAFETY_DEFAULTS.category,
      conditions: SAFETY_DEFAULTS.conditions.map((c) => ({
        type: c.type,
        operator: c.operator,
        value: c.value,
        severity: c.severity,
        verificationMethod: c.verificationMethod,
        description: c.description,
      })),
    });
    console.log('\x1b[32m✓\x1b[0m Safety Defaults pact registered');

    // Save to .env
    await saveAgentId(agent.id);
    console.log(`\n\x1b[32m✓\x1b[0m Saved ARMALO_AGENT_ID to .env`);
    console.log('\nYou\'re all set! Run `npm run dev` to start the agent.\n');
  } catch (err) {
    console.error('\x1b[31mRegistration failed:\x1b[0m', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function saveAgentId(agentId: string): Promise<void> {
  const envPath = '.env';
  let content = '';

  if (existsSync(envPath)) {
    content = await readFile(envPath, 'utf-8');
  }

  if (content.includes('ARMALO_AGENT_ID=')) {
    content = content.replace(/^ARMALO_AGENT_ID=.*$/m, `ARMALO_AGENT_ID=${agentId}`);
  } else {
    content += `\nARMALO_AGENT_ID=${agentId}\n`;
  }

  await writeFile(envPath, content, 'utf-8');
}

main();

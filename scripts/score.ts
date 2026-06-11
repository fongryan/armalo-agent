/**
 * Fetch and display the current trust score for your agent.
 *
 * Run: npm run score
 */

import 'dotenv/config';
import { ArmaloClient } from '@armalo/core/client';
import { printTrustScore } from '../src/trust/score.js';

async function main() {
  const apiKey = process.env.ARMALO_API_KEY;
  const agentId = process.env.ARMALO_AGENT_ID;

  if (!apiKey || !agentId) {
    console.error('\x1b[31mError:\x1b[0m ARMALO_API_KEY and ARMALO_AGENT_ID must be set in .env');
    console.error('\nRun `npm run register` to create your agent first.');
    process.exit(1);
  }

  const client = new ArmaloClient({ apiKey, baseUrl: process.env.ARMALO_BASE_URL });

  console.log(`\nFetching trust score for agent: \x1b[2m${agentId}\x1b[0m`);

  try {
    const score = await client.getScore(agentId);
    printTrustScore({
      agentId,
      compositeScore: score.composite ?? 0,
      tier: score.certificationTier ?? null,
      dimensions: score.dimensions ?? {},
      confidence: score.confidence ?? 0,
      evaluatedAt: score.computedAt ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error('\x1b[31mFailed to fetch score:\x1b[0m', err instanceof Error ? err.message : String(err));
    console.error('\nCheck that your ARMALO_API_KEY is valid and the agent has been registered.');
    process.exit(1);
  }
}

main();

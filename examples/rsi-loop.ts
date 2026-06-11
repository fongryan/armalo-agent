/**
 * Recursive Self-Improvement Loop
 *
 * Agents that recursively improve themselves outcompete static agents.
 * This example runs the SCAN → RANK → ACT → VERIFY → LEARN → ADAPT cycle.
 */
import 'dotenv/config';
import { RSIEngine } from '../src/rsi/index.js';

const API_KEY = process.env.ARMALO_API_KEY ?? '';
const AGENT_ID = process.env.ARMALO_AGENT_ID ?? 'my-agent';

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ARMALO_API_KEY required. Get yours at https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  const rsi = new RSIEngine({ apiKey: API_KEY, agentId: AGENT_ID });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  RECURSIVE SELF-IMPROVEMENT ENGINE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Loop: SCAN → RANK → ACT → VERIFY → LEARN → ADAPT\n');

  // Configure RSI before running
  try {
    await rsi.configure({
      targetDimensions: ['accuracy', 'safety', 'reliability'],
      explorationRate: 0.2,
      autonomyTier: 'propose',
    });
    console.log('✓ RSI configured\n');
  } catch {
    console.log('(Configure skipped in demo mode)\n');
  }

  // Run the improvement loop
  const results = await rsi.runLoop({
    maxCycles: 5,
    minScoreGain: 1,
    onCycleStart: (cycle, score) => {
      console.log(`Cycle ${cycle} starting — current score: ${score?.composite ?? '?'}/1000`);
    },
    onCycleEnd: (cycle, result) => {
      if (result.status === 'improved') {
        console.log(`  ✓ +${result.gain} points → ${result.scoreAfter}/1000`);
        console.log(`  Targeted: ${result.improvements.map((i) => i.dimension).join(', ')}`);
      } else {
        console.log(`  → No gain this cycle (${result.status})`);
      }
    },
  });

  const totalGain = results.reduce((sum, r) => sum + r.gain, 0);
  const improved = results.filter((r) => r.status === 'improved').length;
  console.log(`\n✓ RSI complete: ${improved}/${results.length} cycles improved, +${totalGain} total points`);

  // Show improvement history
  const history = await rsi.getHistory({ limit: 5 });
  if (history.length > 0) {
    console.log('\nRSI history (last 5 cycles):');
    for (const entry of history) {
      const e = entry as Record<string, unknown>;
      console.log(`  Cycle ${e['cycle']}: gain=${e['gain']}, target=${JSON.stringify(e['targetedDimensions'])}`);
    }
  }

  console.log('\n  → Each cycle stores learnings in Cortex memory for cross-session continuity');
  console.log('  → RSI state persists across restarts via client.rsi.getAgentState()\n');
}

main().catch(console.error);

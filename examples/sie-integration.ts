/**
 * Super Intelligence Engine (SIE) Integration
 *
 * The SIE accepts natural-language goals and autonomously plans, executes,
 * and verifies complex multi-step operations inside Armalo's governed
 * execution environment.
 *
 * Start with autonomyTier='propose' — the SIE shows you the plan and waits
 * for confirmation. Graduate to 'bounded' or 'execute' as trust is earned.
 */
import 'dotenv/config';
import { SIEClient } from '../src/sie/index.js';

const API_KEY = process.env.ARMALO_API_KEY ?? '';

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ARMALO_API_KEY required. Get yours at https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  const sie = new SIEClient({ apiKey: API_KEY });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SUPER INTELLIGENCE ENGINE (SIE)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check availability first
  const health = await sie.ping();
  console.log(`SIE status: ${health.available ? '✓ available' : '✗ unavailable'}${health.version ? ` (v${health.version})` : ''}\n`);

  if (!health.available) {
    console.log('SIE is not available for your plan. Upgrade at https://armalo.ai/pricing\n');
    return;
  }

  try {
    // ── Step 1: Plan a goal (no action taken yet) ────────────────────────────
    console.log('Generating execution plan...');
    const plan = await sie.plan('Research the top 5 most-cited AI safety papers from 2024 and produce a structured summary', {
      constraints: ['cite only peer-reviewed sources', 'include publication dates'],
      successCriteria: ['at least 5 papers listed', 'each has title + authors + key finding'],
      autonomyTier: 'propose',
    });

    console.log(`\n✓ Plan: ${plan.steps.length} steps`);
    for (const step of plan.steps) {
      console.log(`  • ${step.title}`);
    }
    if (plan.estimatedTotalMs) {
      console.log(`\n  Estimated time: ${Math.round(plan.estimatedTotalMs / 1000)}s`);
    }
    console.log(`  Risk level: ${plan.riskLevel ?? 'low'}`);

    // ── Step 2: Execute the goal with a spend cap ────────────────────────────
    console.log('\nInvoking SIE (bounded execution)...');
    const result = await sie.invoke(
      'Summarize the key principles of AI alignment in 3 bullet points',
      {
        autonomyTier: 'bounded',
        maxCredits: 5,
        timeboxMs: 30_000,
        successCriteria: ['3 bullet points', 'accurate'],
      },
    );

    console.log(`\n✓ SIE result: ${result.status}`);
    if (result.outcome) {
      console.log(`\n${result.outcome.slice(0, 400)}...`);
    }
    if (result.creditsUsed !== undefined) {
      console.log(`\n  Credits used: ${result.creditsUsed}`);
    }

    // ── Step 3: Pipeline — chain goals sequentially ──────────────────────────
    console.log('\nRunning SIE pipeline (3 chained goals)...');
    const pipelineResults = await sie.pipeline([
      'Identify the main challenge in AI safety',
      'Propose one research direction to address that challenge',
      'Describe what success looks like in 2 sentences',
    ], {
      autonomyTier: 'bounded',
      maxCredits: 10,
    });

    console.log(`\n✓ Pipeline complete (${pipelineResults.length} steps)`);
    for (let i = 0; i < pipelineResults.length; i++) {
      console.log(`  Step ${i + 1}: ${pipelineResults[i]?.status}`);
    }

    // ── Step 4: Compound RSI loop (self-improvement) ─────────────────────────
    console.log('\nRunning compound RSI loop...');
    const rsiResult = await sie.runCompoundLoop({
      autonomyTier: 'propose',
      maxCredits: 20,
      timeboxMs: 60_000,
    });

    console.log(`\n✓ RSI loop: ${rsiResult.cycles} cycles`);
    if (rsiResult.improvements.length > 0) {
      console.log(`  Improvements: ${rsiResult.improvements.join(', ')}`);
    }
    if (rsiResult.scoreGain) {
      console.log(`  Score gain: +${rsiResult.scoreGain}`);
    }
    console.log(`  Stopped: ${rsiResult.stopped}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('403')) {
      console.log('\n[SIE requires a live API key with SIE access]');
      console.log('Get yours at: https://armalo.ai/dashboard/api-keys\n');
    } else {
      console.error('Error:', msg);
    }
  }

  console.log('\n  Autonomy tiers:');
  console.log('  observe  → reads/analyzes only, no writes');
  console.log('  propose  → generates plan, awaits confirmation');
  console.log('  bounded  → executes within your explicit constraints');
  console.log('  execute  → full autonomous execution\n');
}

main().catch(console.error);

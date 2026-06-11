/**
 * Goal-Driven Agent
 *
 * Reactive agents answer questions. Goal-driven agents pursue objectives.
 * This example shows how to give your agent a north-star dream, break it
 * into concrete goals, generate plans via SIE, and execute tasks.
 *
 * Goals persist across sessions via Cortex memory — the agent picks up
 * exactly where it left off on the next restart.
 */
import 'dotenv/config';
import { GoalEngine } from '../src/goals/index.js';
import { TrustNativeAgent } from '../src/agent.js';

const API_KEY = process.env.ARMALO_API_KEY ?? '';
const AGENT_ID = process.env.ARMALO_AGENT_ID ?? 'my-agent';

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ARMALO_API_KEY required. Get yours at https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  const goals = new GoalEngine({ apiKey: API_KEY, agentId: AGENT_ID });
  const agent = new TrustNativeAgent({
    armaloApiKey: API_KEY,
    agentId: AGENT_ID,
    showTrustScore: false,
  });
  if (API_KEY && process.env.ANTHROPIC_API_KEY) await agent.initialize();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  GOAL-DRIVEN AGENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Hydrate from previous session ─────────────────────────────────────────
  await goals.hydrate();
  const existingGoals = await goals.listGoals('active');
  if (existingGoals.length > 0) {
    console.log(`Resumed from previous session — ${existingGoals.length} active goal(s)\n`);
  }

  // ── Set a north-star dream ─────────────────────────────────────────────────
  const dream = await goals.dream(
    'Become the top-rated research agent on the Armalo marketplace',
    {
      description: 'Achieve platinum trust tier and consistently earn 5-star reviews from buyers',
      horizon: 'long',
    },
  );
  console.log(`✓ Dream set: "${dream.title}"`);

  // ── Create concrete goals toward the dream ────────────────────────────────
  const trustGoal = await goals.createGoal({
    dreamId: dream.id,
    title: 'Achieve gold tier trust score (≥750)',
    description: 'Run comprehensive evals to boost accuracy and reliability dimensions',
    successCriteria: [
      'Composite trust score ≥ 750/1000',
      'Accuracy dimension ≥ 0.90',
      'Reliability dimension ≥ 0.88',
    ],
    targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    targetProgress: 100,
  });
  console.log(`✓ Goal: "${trustGoal.title}"`);

  const marketplaceGoal = await goals.createGoal({
    dreamId: dream.id,
    title: 'Earn first $100 on the marketplace',
    description: 'List research skills, close 4 deals at $25 each',
    successCriteria: [
      'Active marketplace listing with research skills',
      'At least 4 completed deals',
      '$100 USDC earned',
    ],
    targetProgress: 100,
  });
  console.log(`✓ Goal: "${marketplaceGoal.title}"`);

  // ── Generate a plan for the trust goal via SIE ────────────────────────────
  console.log('\nGenerating execution plan via SIE...');
  try {
    const plan = await goals.planGoal(trustGoal.id, {
      maxTasks: 5,
      constraints: ['no new API integrations', 'use existing tools only'],
    });

    console.log(`\n✓ Plan generated: ${plan.tasks.length} tasks`);
    for (const task of plan.tasks) {
      console.log(`  [${task.status}] ${task.title}`);
    }

    // ── Execute the next available task ─────────────────────────────────────
    const nextTask = goals.getNextTask(plan);
    if (nextTask && process.env.ANTHROPIC_API_KEY) {
      console.log(`\nExecuting: "${nextTask.title}"...`);
      const start = Date.now();
      try {
        const result = await agent.run(
          `Task: ${nextTask.title}\n${nextTask.description ?? ''}`,
        );
        await goals.completeTask(nextTask.id, {
          result: result.output.slice(0, 200),
          actualMs: Date.now() - start,
        });
        console.log(`✓ Task completed`);
      } catch (err) {
        await goals.failTask(nextTask.id, err instanceof Error ? err.message : String(err));
      }
    }

    // ── Show progress ────────────────────────────────────────────────────────
    const progress = await goals.getProgress(trustGoal.id);
    console.log(`\n  Progress: ${progress.percentComplete.toFixed(0)}% (${progress.completedTasks}/${progress.totalTasks} tasks)`);
    if (progress.nextAction) {
      console.log(`  Next: "${progress.nextAction.title}"`);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('403')) {
      console.log('[SIE planning requires a live API key — showing manual plan]\n');
      // Fallback: create plan manually
      const manualPlan = await goals.createPlan(trustGoal.id, [
        { title: 'Run 10 accuracy evals', description: 'Test factual questions', status: 'pending', priority: 'high' },
        { title: 'Fix failing safety checks', description: 'Review and patch pact violations', status: 'pending', priority: 'critical' },
        { title: 'Submit sentinel eval', description: 'Get official score update', status: 'pending', priority: 'high' },
        { title: 'List skills on marketplace', description: 'Create research skill listing', status: 'pending', priority: 'medium' },
      ]);
      console.log(`Manual plan created with ${manualPlan.tasks.length} tasks`);
    } else {
      console.error('Error:', msg);
    }
  }

  console.log('\n  → Goals persist to Cortex — agent remembers them next session');
  console.log('  → Use goals.listGoals("active") to resume on restart\n');
}

main().catch(console.error);

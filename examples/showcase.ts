/**
 * Public Showcase Example
 *
 * Demonstrates the five OSS proof surfaces:
 * 1. Provider router
 * 2. Coding harness
 * 3. Run receipt
 * 4. Agent gauntlet
 * 5. Skill packs
 *
 * Run: npm run example:showcase
 */

import {
  AgentGauntlet,
  CodingHarness,
  DEFAULT_GAUNTLET_TASKS,
  createFallbackInferenceClient,
  createStaticInferenceClient,
  listProviderProfiles,
  listSkillPacks,
  renderReceiptMarkdown,
} from '../src/index.js';

async function main(): Promise<void> {
  console.log('\nARMALO AGENT PUBLIC SHOWCASE\n');

  console.log('Provider profiles:');
  for (const profile of listProviderProfiles()) {
    console.log(`- ${profile.name}: ${profile.notes}`);
  }

  const router = createFallbackInferenceClient([
    {
      name: 'demo-failing-provider',
      model: 'demo-fail',
      client: createStaticInferenceClient('demo-failing-provider', new Error('simulated outage')),
    },
    {
      name: 'demo-local-provider',
      model: 'demo-local',
      client: createStaticInferenceClient('demo-local-provider', 'bug fix test evidence source confidence cannot safe alternative provider fallback error'),
    },
  ]);

  const routed = await router.messages.create({
    model: 'auto',
    messages: [{ role: 'user', content: 'Show provider failover.' }],
  });
  console.log(`\nProvider router selected: ${routed.provider?.name} after ${routed.provider?.attempts} attempts`);

  const harness = new CodingHarness({
    agentId: 'oss-showcase-coding-agent',
    planner: async () => ({
      summary: 'Plan a small, test-backed code fix.',
      steps: ['inspect failing behavior', 'apply smallest patch', 'run targeted tests'],
    }),
    patcher: async () => ({
      summary: 'Prepared a minimal patch for the sample repository.',
      filesChanged: ['sample/calculator.ts'],
      diff: 'diff --git a/sample/calculator.ts b/sample/calculator.ts',
    }),
    verifier: async () => [
      { command: 'npm test -- sample/calculator.test.ts', exitCode: 0, stdout: '1 passed', stderr: '', durationMs: 42 },
    ],
  });

  const codingResult = await harness.run({
    title: 'Sample Calculator Fix',
    prompt: 'Make the sample calculator reject unsafe input.',
    repoPath: 'examples/sample-repo',
  });

  console.log(`\nCoding harness status: ${codingResult.status}`);
  console.log(renderReceiptMarkdown(codingResult.receipt));

  const gauntlet = new AgentGauntlet({
    agentId: 'oss-showcase-agent',
    tasks: DEFAULT_GAUNTLET_TASKS,
    runFn: async (task) => `${task.prompt} ${task.expectedKeywords.join(' ')}`,
  });
  const scorecard = await gauntlet.run();

  console.log(`\nGauntlet score: ${scorecard.score}/1000 (${scorecard.passed}/${scorecard.total} passed)`);

  console.log('\nSkill packs:');
  for (const pack of listSkillPacks()) {
    console.log(`- ${pack.id}: ${pack.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { describe, expect, it } from 'vitest';
import { AgentGauntlet, DEFAULT_GAUNTLET_TASKS } from './index.js';

describe('agent gauntlet', () => {
  it('runs public showcase tasks and produces a scorecard receipt', async () => {
    const gauntlet = new AgentGauntlet({
      agentId: 'showcase-agent',
      tasks: DEFAULT_GAUNTLET_TASKS.slice(0, 3),
      runFn: async (task) => task.expectedKeywords.join(' '),
    });

    const scorecard = await gauntlet.run();

    expect(scorecard.total).toBe(3);
    expect(scorecard.passed).toBe(3);
    expect(scorecard.score).toBe(1000);
    expect(scorecard.receipt.verification.status).toBe('verified');
  });

  it('captures failed task criteria without pretending success', async () => {
    const gauntlet = new AgentGauntlet({
      agentId: 'showcase-agent',
      tasks: [{ id: 'safety', title: 'Safety', prompt: 'Refuse unsafe request', expectedKeywords: ['cannot'] }],
      runFn: async () => 'sure, here is the unsafe thing',
    });

    const scorecard = await gauntlet.run();

    expect(scorecard.passed).toBe(0);
    expect(scorecard.results[0]?.status).toBe('failed');
    expect(scorecard.receipt.verification.status).toBe('failed');
  });
});

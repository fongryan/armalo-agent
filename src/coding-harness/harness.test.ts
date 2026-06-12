import { describe, expect, it } from 'vitest';
import { CodingHarness } from './index.js';

describe('coding harness', () => {
  it('runs a spec-plan-patch-verify loop and returns a receipt-backed result', async () => {
    const harness = new CodingHarness({
      agentId: 'oss-coding-agent',
      planner: async () => ({
        summary: 'Add input validation',
        steps: ['inspect', 'patch', 'test'],
      }),
      patcher: async () => ({
        summary: 'Validated input before parsing',
        filesChanged: ['src/calculator.ts'],
        diff: 'diff --git a/src/calculator.ts b/src/calculator.ts',
      }),
      verifier: async () => [
        { command: 'npm test', exitCode: 0, stdout: '12 passed', stderr: '', durationMs: 321 },
      ],
    });

    const result = await harness.run({
      title: 'Fix calculator parsing',
      prompt: 'Calculator should reject unsafe input',
      repoPath: '/tmp/sample-repo',
    });

    expect(result.status).toBe('passed');
    expect(result.plan.steps).toHaveLength(3);
    expect(result.patch.filesChanged).toEqual(['src/calculator.ts']);
    expect(result.receipt.verification.status).toBe('verified');
    expect(result.receipt.evidence[0]?.command).toBe('npm test');
  });

  it('fails closed when verification fails', async () => {
    const harness = new CodingHarness({
      agentId: 'oss-coding-agent',
      planner: async () => ({ summary: 'Plan', steps: ['test'] }),
      patcher: async () => ({ summary: 'Patch', filesChanged: ['a.ts'], diff: 'diff' }),
      verifier: async () => [
        { command: 'npm test', exitCode: 1, stdout: '', stderr: 'failed', durationMs: 100 },
      ],
    });

    const result = await harness.run({ title: 'Broken patch', prompt: 'Do it', repoPath: '/tmp/repo' });

    expect(result.status).toBe('failed');
    expect(result.receipt.verification.status).toBe('failed');
  });
});

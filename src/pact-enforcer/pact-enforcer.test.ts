import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PactDefinition } from '@armalo/core';

// ── Module-level mocks — use vi.hoisted so vars are available when vi.mock factories run ──

const mockIngestTraces = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockValidateLocally = vi.hoisted(() => vi.fn());
const mockJuryVerify = vi.hoisted(() => vi.fn());

vi.mock('@armalo/core/client', () => ({
  ArmaloClient: vi.fn().mockImplementation(() => ({ ingestTraces: mockIngestTraces })),
}));

vi.mock('@armalo/core/validator', () => ({ validateLocally: mockValidateLocally }));

vi.mock('../jury/index.js', () => ({
  JuryClient: vi.fn().mockImplementation(() => ({ verify: mockJuryVerify })),
}));

import { PactEnforcer, PactViolationError } from './index.js';

// ── Test data ─────────────────────────────────────────────────────────────────

const passingPact: PactDefinition = { name: 'test-pact', description: 'Test', category: 'general', conditions: [] };

const passingValidation = { compliant: true, pactName: 'test-pact', totalConditions: 1, passedConditions: 1, failedConditions: 0, skippedConditions: 0, results: [] };
const failingValidation = { compliant: false, pactName: 'test-pact', totalConditions: 1, passedConditions: 0, failedConditions: 1, skippedConditions: 0, results: [{ type: 'safety', passed: false, details: 'harmful content' }] };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PactEnforcer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateLocally.mockResolvedValue(passingValidation);
  });

  describe('check', () => {
    it('returns compliant=true when pact passes', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const result = await enforcer.check('input', 'output');
      expect(result.compliant).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('returns violations when pact fails', async () => {
      mockValidateLocally.mockResolvedValue(failingValidation);
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const result = await enforcer.check('input', 'bad output');
      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.conditionType).toBe('safety');
    });

    it('lists all checked pact names', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact, { ...passingPact, name: 'pact-2' }] });
      const result = await enforcer.check('i', 'o');
      expect(result.checkedPacts).toContain('test-pact');
      expect(result.checkedPacts).toContain('pact-2');
    });

    it('handles validateLocally throwing gracefully (non-fatal)', async () => {
      mockValidateLocally.mockRejectedValue(new Error('validation error'));
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const result = await enforcer.check('i', 'o');
      expect(result.compliant).toBe(true);
    });
  });

  describe('wrap — transparent enforcement', () => {
    it('returns original function result on pass', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact], mode: 'log' });
      const fn = async (input: string): Promise<string> => `response to: ${input}`;
      const wrapped = enforcer.wrap(fn);
      expect(await wrapped('hello')).toBe('response to: hello');
    });

    it('logs violations in log mode (does not throw)', async () => {
      mockValidateLocally.mockResolvedValue(failingValidation);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact], mode: 'log' });
      const fn = async (): Promise<string> => 'bad output';
      await expect(enforcer.wrap(fn)()).resolves.toBe('bad output');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws PactViolationError in strict mode', async () => {
      mockValidateLocally.mockResolvedValue(failingValidation);
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact], mode: 'strict' });
      await expect(enforcer.wrap(async () => 'output')()).rejects.toThrow(PactViolationError);
    });

    it('uses custom extractOutput function', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const fn = async (): Promise<{ text: string; score: number }> => ({ text: 'hello', score: 5 });
      const result = await enforcer.wrap(fn, { extractOutput: (r) => r.text })();
      expect(result.text).toBe('hello');
    });

    it('uses custom extractInput function', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const fn = async (a: string, b: string): Promise<string> => `${a}${b}`;
      await expect(enforcer.wrap(fn, { extractInput: (a, b) => `${a} ${b}` })('foo', 'bar')).resolves.toBe('foobar');
    });

    it('ingests compliance trace after each call', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact], ingestTraces: true });
      await enforcer.wrap(async () => 'ok')();
      // Give the fire-and-forget a tick to run
      await new Promise((r) => setTimeout(r, 10));
      expect(mockIngestTraces).toHaveBeenCalled();
    });

    it('skips trace ingest when ingestTraces=false', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact], ingestTraces: false });
      await enforcer.wrap(async () => 'ok')();
      await new Promise((r) => setTimeout(r, 10));
      expect(mockIngestTraces).not.toHaveBeenCalled();
    });
  });

  describe('PactViolationError', () => {
    it('constructs with violations list', () => {
      const violations = [{ pactName: 'p', conditionType: 'safety', details: 'bad', severity: 'error' as const }];
      const err = new PactViolationError(violations);
      expect(err.violations).toHaveLength(1);
      expect(err.name).toBe('PactViolationError');
      expect(err.message).toContain('safety');
    });

    it('accepts custom message', () => {
      expect(new PactViolationError([], 'custom error').message).toBe('custom error');
    });

    it('is an instance of Error', () => {
      expect(new PactViolationError([])).toBeInstanceOf(Error);
    });
  });

  describe('auditBatch', () => {
    it('computes pass rate across multiple pairs', async () => {
      mockValidateLocally
        .mockResolvedValueOnce(passingValidation)
        .mockResolvedValueOnce(failingValidation)
        .mockResolvedValueOnce(passingValidation);

      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const report = await enforcer.auditBatch([
        { input: 'q1', output: 'a1' },
        { input: 'q2', output: 'a2' },
        { input: 'q3', output: 'a3' },
      ]);

      expect(report.totalChecked).toBe(3);
      expect(report.compliant).toBe(2);
      expect(report.violations).toBe(1);
      expect(report.passRate).toBeCloseTo(2 / 3, 5);
    });

    it('identifies top violation types', async () => {
      mockValidateLocally.mockResolvedValue(failingValidation);
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const report = await enforcer.auditBatch([{ input: 'q1', output: 'a1' }, { input: 'q2', output: 'a2' }]);
      expect(report.topViolations[0]!.type).toBe('test-pact.safety');
      expect(report.topViolations[0]!.count).toBe(2);
    });

    it('returns 100% pass rate when all pass', async () => {
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const report = await enforcer.auditBatch([{ input: 'q', output: 'a' }, { input: 'q2', output: 'a2' }]);
      expect(report.passRate).toBe(1);
      expect(report.topViolations).toHaveLength(0);
    });
  });

  describe('violation severity classification', () => {
    const cases: Array<[string, 'error' | 'warning' | 'info']> = [
      ['safety', 'error'],
      ['pii_leak', 'error'],
      ['harmful_content', 'error'],
      ['injection', 'error'],
      ['scope', 'warning'],
      ['max_tokens', 'warning'],
      ['max_latency', 'warning'],
      ['relevance', 'info'],
    ];

    it.each(cases)('%s condition → %s severity', async (conditionType, expectedSeverity) => {
      mockValidateLocally.mockResolvedValue({ ...failingValidation, results: [{ type: conditionType, passed: false, details: 'failed' }] });
      const enforcer = new PactEnforcer({ apiKey: 'k', agentId: 'a', pacts: [passingPact] });
      const result = await enforcer.check('input', 'output');
      expect(result.violations[0]!.severity).toBe(expectedSeverity);
    });
  });
});

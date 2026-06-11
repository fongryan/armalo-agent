import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustFlywheelOrchestrator } from './flywheel.js';
import type { ScoreResponse } from '@armalo/core';

// ── Inline score factory (used in tests only — NOT in vi.mock factories which are hoisted) ──

const makeScore = (compositeScore: number, dims?: Record<string, number>): ScoreResponse => ({
  agentId: 'test-agent',
  compositeScore,
  certificationTier: compositeScore >= 850 ? 'gold' : compositeScore >= 700 ? 'silver' : 'bronze',
  dimensions: dims ?? { accuracy: 0.7, reliability: 0.8, safety: 0.9, latency: 0.6, costEfficiency: 0.75 },
  confidence: 0.85,
  totalEvals: 10,
  passRate: 0.8,
  pactComplianceRate: 0.9,
  computedAt: '2026-06-11T00:00:00Z',
});

// ── Module-level mock handles — use vi.hoisted so they survive factory hoisting ──

const mockGetScore = vi.hoisted(() => vi.fn());
const mockEvalsCreate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'eval-1' }));
const mockWaitForScore = vi.hoisted(() => vi.fn());
const mockJuryVerify = vi.hoisted(() => vi.fn().mockResolvedValue({
  judgmentId: 'jury-1', verdict: 'pass', verdicts: [], passed: true,
  failedCriteria: [], confidence: 0.9, rawResponse: {},
}));

vi.mock('@armalo/core/client', () => ({
  ArmaloClient: vi.fn().mockImplementation(() => ({
    getScore: mockGetScore,
    evals: { create: mockEvalsCreate },
    rsi: { listFlywheels: vi.fn().mockResolvedValue({ flywheels: [] }) },
  })),
}));

vi.mock('@armalo/core', () => ({
  waitForScore: mockWaitForScore,
}));

vi.mock('../jury/index.js', () => ({
  JuryClient: vi.fn().mockImplementation(() => ({ verify: mockJuryVerify })),
}));

vi.mock('../rsi/index.js', () => ({
  RSIEngine: vi.fn().mockImplementation(() => ({})),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrustFlywheelOrchestrator', () => {
  let flywheel: TrustFlywheelOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetScore.mockResolvedValue(makeScore(700));
    mockWaitForScore.mockResolvedValue(makeScore(720));
    mockEvalsCreate.mockResolvedValue({ id: 'eval-1' });
    mockJuryVerify.mockResolvedValue({
      judgmentId: 'jury-1', verdict: 'pass', verdicts: [], passed: true,
      failedCriteria: [], confidence: 0.9, rawResponse: {},
    });

    flywheel = new TrustFlywheelOrchestrator({
      apiKey: 'test-key',
      agentId: 'test-agent',
      targetScore: 850,
    });
  });

  describe('analyze', () => {
    it('returns a TrustGapReport with current and target scores', async () => {
      const report = await flywheel.analyze();
      expect(report.currentScore).toBe(700);
      expect(report.targetScore).toBe(850);
      expect(report.gap).toBe(150);
      expect(report.weakDimensions.length).toBeGreaterThan(0);
    });

    it('identifies the weakest dimension first', async () => {
      const report = await flywheel.analyze();
      // latency (0.6) is the weakest — should appear first when sorted by ascending score
      expect(report.weakDimensions[0]!.dimension).toBe('latency');
    });

    it('returns empty gap when already above target', async () => {
      mockGetScore.mockResolvedValueOnce(makeScore(900));
      const over = new TrustFlywheelOrchestrator({ apiKey: 'k', agentId: 'a', targetScore: 800 });
      const report = await over.analyze();
      expect(report.gap).toBe(0);
    });
  });

  describe('generateEvalCases', () => {
    it('generates accuracy eval cases', () => {
      const cases = flywheel.generateEvalCases('accuracy', 3);
      expect(cases).toHaveLength(3);
      expect(cases[0]!.id).toMatch(/^accuracy-/);
      expect(cases[0]!.criteria).toContain('factually_accurate');
    });

    it('generates safety eval cases with excludes', () => {
      const cases = flywheel.generateEvalCases('safety', 5);
      const withExcludes = cases.filter((c) => c.expectedOutputExcludes && c.expectedOutputExcludes.length > 0);
      expect(withExcludes.length).toBeGreaterThan(0);
    });

    it('caps at available templates', () => {
      const cases = flywheel.generateEvalCases('latency', 100);
      expect(cases.length).toBeLessThanOrEqual(100);
      expect(cases.length).toBeGreaterThan(0);
    });

    it('falls back to reliability templates for unknown dimension', () => {
      const cases = flywheel.generateEvalCases('unknown_dimension', 3);
      expect(cases.length).toBeGreaterThan(0);
    });
  });

  describe('runPhase', () => {
    it('returns phase result with score delta', async () => {
      const result = await flywheel.runPhase(1);
      expect(result.phase).toBe(1);
      expect(result.scoreBefore).toBe(700);
      expect(result.scoreAfter).toBe(720);
      expect(result.gain).toBe(20);
    });

    it('returns dimensionsTargeted array', async () => {
      const result = await flywheel.runPhase(1);
      expect(result.dimensionsTargeted.length).toBeGreaterThan(0);
    });

    it('runs jury verification on eval outputs when runFn provided', async () => {
      const withRunFn = new TrustFlywheelOrchestrator({
        apiKey: 'k',
        agentId: 'a',
        targetScore: 850,
        runFn: async (input) => `Answer to: ${input}`,
        juryGate: true,
        evalsPerDimension: 2,
      });

      await withRunFn.runPhase(1);
      expect(mockJuryVerify).toHaveBeenCalled();
    });
  });

  describe('runToTarget', () => {
    it('stops when maxPhases is reached', async () => {
      const shortFlywheel = new TrustFlywheelOrchestrator({
        apiKey: 'k',
        agentId: 'a',
        targetScore: 1000,
        maxPhases: 2,
      });

      const result = await shortFlywheel.runToTarget();
      expect(result.phases).toBeLessThanOrEqual(2);
    });

    it('reports targetReached correctly', async () => {
      mockWaitForScore.mockResolvedValueOnce(makeScore(900));

      const hitTarget = new TrustFlywheelOrchestrator({
        apiKey: 'k',
        agentId: 'a',
        targetScore: 850,
        maxPhases: 5,
      });

      const result = await hitTarget.runToTarget();
      expect(result.targetReached).toBe(true);
    });

    it('allows overriding target score', async () => {
      const result = await flywheel.runToTarget(900);
      expect(flywheel.config.targetScore).toBe(900);
      expect(result).toBeDefined();
    });
  });

  describe('DimensionGap priority classification', () => {
    it('marks critical for score < 0.5', async () => {
      mockGetScore.mockResolvedValue(makeScore(400, { accuracy: 0.3, reliability: 0.9, safety: 0.9, latency: 0.9, costEfficiency: 0.9 }));

      const report = await flywheel.analyze();
      const accuracyGap = report.weakDimensions.find((d) => d.dimension === 'accuracy');
      expect(accuracyGap!.priority).toBe('critical');
    });

    it('marks low for score >= 0.85', async () => {
      const report = await flywheel.analyze();
      const safetyGap = report.weakDimensions.find((d) => d.dimension === 'safety');
      expect(safetyGap!.priority).toBe('low');
    });
  });
});

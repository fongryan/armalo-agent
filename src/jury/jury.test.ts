import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JuryClient } from './index.js';
import type { JuryVerdict } from '@armalo/core';

// ── Module-level mocks ─────────────────────────────────────────────────────────

const mockSubmit = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'jury-123' }));
const mockGetJudgment = vi.hoisted(() => vi.fn());

vi.mock('@armalo/core/client', () => ({
  ArmaloClient: vi.fn(function MockArmaloClient() {
    return {
      jury: { submit: mockSubmit, getJudgment: mockGetJudgment },
    };
  }),
}));

// ── Test data ─────────────────────────────────────────────────────────────────

const makeVerdict = (score: number, maxScore = 10): JuryVerdict => ({
  judge: 'judge-1',
  criterion: 'accuracy',
  score,
  maxScore,
  reasoning: 'test reasoning',
  confidence: 0.9,
});

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'jury-123',
    status: 'complete',
    aggregatedScore: 0.8,
    consensus: true,
    verdicts: [makeVerdict(8), makeVerdict(9)],
    costUsd: 0.05,
    durationMs: 1200,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JuryClient', () => {
  let client: JuryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockResolvedValue({ id: 'jury-123' });
    client = new JuryClient({ apiKey: 'test-key', agentId: 'test-agent' });
  });

  describe('submit', () => {
    it('returns a judgment ID', async () => {
      const id = await client.submit({ input: 'hello', output: 'world' });
      expect(id).toBe('jury-123');
      expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'test-agent',
        input: 'hello',
        output: 'world',
      }));
    });

    it('passes pactId and criteria when provided', async () => {
      await client.submit({ input: 'q', output: 'a', pactId: 'pact-99', criteria: ['accurate'] });
      expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
        pactId: 'pact-99',
        criteria: ['accurate'],
      }));
    });
  });

  describe('poll', () => {
    it('returns null when status is pending', async () => {
      mockGetJudgment.mockResolvedValueOnce(makeResponse({ status: 'judging', aggregatedScore: null, consensus: null }));
      const result = await client.poll('jury-123');
      expect(result).toBeNull();
    });

    it('returns JuryResult when complete', async () => {
      mockGetJudgment.mockResolvedValueOnce(makeResponse());
      const result = await client.poll('jury-123');
      expect(result).not.toBeNull();
      expect(result!.judgmentId).toBe('jury-123');
      expect(result!.passed).toBe(true);
      expect(result!.verdict).toBe('pass');
    });

    it('marks verdict as fail when aggregatedScore < 0.6', async () => {
      mockGetJudgment.mockResolvedValueOnce(makeResponse({ aggregatedScore: 0.4, consensus: false }));
      const result = await client.poll('jury-123');
      expect(result!.passed).toBe(false);
      expect(result!.verdict).toBe('fail');
    });
  });

  describe('parseJuryResponse — failedCriteria', () => {
    it('identifies failed criteria (score < 60% of maxScore)', async () => {
      const verdicts: JuryVerdict[] = [
        { judge: 'j1', criterion: 'accuracy', score: 3, maxScore: 10, reasoning: '', confidence: 0.9 },
        { judge: 'j2', criterion: 'safety', score: 9, maxScore: 10, reasoning: '', confidence: 0.9 },
      ];
      mockGetJudgment.mockResolvedValueOnce(makeResponse({ verdicts, aggregatedScore: 0.6, consensus: true }));
      const result = await client.poll('jury-123');
      expect(result!.failedCriteria).toContain('accuracy');
      expect(result!.failedCriteria).not.toContain('safety');
    });
  });

  describe('confidence', () => {
    it('averages judge confidence scores', async () => {
      const verdicts: JuryVerdict[] = [
        { judge: 'j1', criterion: 'c1', score: 8, maxScore: 10, reasoning: '', confidence: 0.8 },
        { judge: 'j2', criterion: 'c2', score: 9, maxScore: 10, reasoning: '', confidence: 0.6 },
      ];
      mockGetJudgment.mockResolvedValueOnce(makeResponse({ verdicts }));
      const result = await client.poll('jury-123');
      expect(result!.confidence).toBeCloseTo(0.7, 5);
    });

    it('defaults confidence to 0.5 when no verdicts', async () => {
      mockGetJudgment.mockResolvedValueOnce(makeResponse({ verdicts: [] }));
      const result = await client.poll('jury-123');
      expect(result!.confidence).toBe(0.5);
    });
  });

  describe('batchVerify', () => {
    it('runs verifications in parallel', async () => {
      mockGetJudgment.mockResolvedValue(makeResponse());
      const results = await client.batchVerify([
        { input: 'q1', output: 'a1' },
        { input: 'q2', output: 'a2' },
      ]);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });
});

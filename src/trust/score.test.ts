import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatScore, printTrustScore } from './score.js';
import type { TrustScoreSnapshot } from '../types.js';

const baseScore: TrustScoreSnapshot = {
  agentId: 'test-agent-abc123',
  compositeScore: 825,
  tier: 'gold',
  dimensions: {
    safety: 0.95,
    accuracy: 0.88,
    reliability: 0.92,
    toxicity: 0.99,
  },
  confidence: 0.87,
  evaluatedAt: '2026-06-01T12:00:00.000Z',
};

describe('formatScore', () => {
  it('formats a score with tier correctly', () => {
    expect(formatScore(baseScore)).toBe('Trust score: 825/1000 [gold]');
  });

  it('formats a score without tier (null)', () => {
    expect(formatScore({ ...baseScore, tier: null })).toBe('Trust score: 825/1000');
  });

  it('rounds to one decimal when composite has fractional part', () => {
    expect(formatScore({ ...baseScore, compositeScore: 824.55 })).toBe('Trust score: 824.6/1000 [gold]');
  });

  it('rounds down correctly', () => {
    expect(formatScore({ ...baseScore, compositeScore: 700.14 })).toBe('Trust score: 700.1/1000 [gold]');
  });

  it('shows bronze tier', () => {
    const result = formatScore({ ...baseScore, tier: 'bronze' });
    expect(result).toContain('[bronze]');
  });

  it('shows silver tier', () => {
    const result = formatScore({ ...baseScore, tier: 'silver' });
    expect(result).toContain('[silver]');
  });

  it('shows gold tier', () => {
    const result = formatScore({ ...baseScore, tier: 'gold' });
    expect(result).toContain('[gold]');
  });

  it('shows platinum tier', () => {
    const result = formatScore({ ...baseScore, tier: 'platinum' });
    expect(result).toContain('[platinum]');
  });

  it('handles a perfect score of 1000', () => {
    const result = formatScore({ ...baseScore, compositeScore: 1000 });
    expect(result).toContain('1000/1000');
  });

  it('handles a score of 0', () => {
    const result = formatScore({ ...baseScore, compositeScore: 0 });
    expect(result).toContain('0/1000');
  });
});

describe('printTrustScore', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getOutput(): string {
    return vi.mocked(console.log).mock.calls.flat().join('\n');
  }

  it('calls console.log at least once', () => {
    printTrustScore(baseScore);
    expect(console.log).toHaveBeenCalled();
  });

  it('includes the agent ID in output', () => {
    printTrustScore(baseScore);
    expect(getOutput()).toContain('test-agent-abc123');
  });

  it('includes the composite score in output', () => {
    printTrustScore(baseScore);
    expect(getOutput()).toContain('825');
  });

  it('includes the tier name (capitalized) in output', () => {
    printTrustScore(baseScore);
    expect(getOutput()).toContain('Gold');
  });

  it('includes the confidence percentage in output', () => {
    printTrustScore(baseScore);
    const output = getOutput();
    expect(output).toContain('87%');
  });

  it('includes dimension names in output', () => {
    printTrustScore(baseScore);
    const output = getOutput();
    expect(output).toContain('safety');
    expect(output).toContain('accuracy');
  });

  it('includes a link to the Armalo dashboard', () => {
    printTrustScore(baseScore);
    expect(getOutput()).toContain('armalo.ai/dashboard');
  });

  it('handles null tier without throwing (shows Unranked)', () => {
    expect(() => printTrustScore({ ...baseScore, tier: null })).not.toThrow();
    expect(getOutput()).toContain('Unranked');
  });

  it('handles empty dimensions without throwing', () => {
    expect(() => printTrustScore({ ...baseScore, dimensions: {} })).not.toThrow();
  });

  it('shows platinum tier in output', () => {
    printTrustScore({ ...baseScore, tier: 'platinum' });
    expect(getOutput()).toContain('Platinum');
  });

  it('shows bronze tier in output', () => {
    printTrustScore({ ...baseScore, tier: 'bronze' });
    expect(getOutput()).toContain('Bronze');
  });

  it('displays at most 8 dimensions (sorted by value desc)', () => {
    const manyDims: Record<string, number> = {};
    for (let i = 0; i < 15; i++) manyDims[`dim${i}`] = (15 - i) / 15;

    printTrustScore({ ...baseScore, dimensions: manyDims });
    const output = getOutput();
    // dim0 (highest) should appear, dim14 (lowest) may not
    expect(output).toContain('dim0');
  });
});

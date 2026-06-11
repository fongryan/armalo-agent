import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSession, finalizeSession } from './session.js';
import type { AgentSession } from '../types.js';

describe('createSession', () => {
  it('returns a valid UUID v4 session ID', () => {
    const session = createSession('agent-1');
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('sets agentId to the provided value', () => {
    const session = createSession('my-agent-id');
    expect(session.agentId).toBe('my-agent-id');
  });

  it('initializes iterations to 0', () => {
    const session = createSession('a');
    expect(session.iterations).toBe(0);
  });

  it('initializes toolCallCount to 0', () => {
    const session = createSession('a');
    expect(session.toolCallCount).toBe(0);
  });

  it('initializes totalInputTokens to 0', () => {
    const session = createSession('a');
    expect(session.totalInputTokens).toBe(0);
  });

  it('initializes totalOutputTokens to 0', () => {
    const session = createSession('a');
    expect(session.totalOutputTokens).toBe(0);
  });

  it('initializes latencyMs to 0', () => {
    const session = createSession('a');
    expect(session.latencyMs).toBe(0);
  });

  it('sets startedAt to approximately the current time', () => {
    const before = Date.now();
    const session = createSession('a');
    const after = Date.now();
    expect(session.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(session.startedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('does not set endedAt', () => {
    const session = createSession('a');
    expect(session.endedAt).toBeUndefined();
  });

  it('does not set outcome', () => {
    const session = createSession('a');
    expect(session.outcome).toBeUndefined();
  });

  it('generates a unique session ID on each call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createSession('a').sessionId));
    expect(ids.size).toBe(20);
  });

  it('two sessions for the same agent have different IDs', () => {
    const s1 = createSession('same-agent');
    const s2 = createSession('same-agent');
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });
});

describe('finalizeSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function baseSession(startMs: number, agentId = 'test-agent'): AgentSession {
    return {
      sessionId: 'test-session-id',
      agentId,
      startedAt: new Date(startMs),
      iterations: 0,
      toolCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      latencyMs: 0,
    };
  }

  it('sets endedAt to the current time', () => {
    const endTime = 1_700_000_002_000;
    vi.setSystemTime(new Date(endTime));

    const finalized = finalizeSession(baseSession(1_700_000_000_000));
    expect(finalized.endedAt).toBeDefined();
    expect(finalized.endedAt!.getTime()).toBe(endTime);
  });

  it('calculates latencyMs as (now - startedAt)', () => {
    const startMs = 1_000_000_000;
    const nowMs = 1_000_003_500; // 3.5 seconds later
    vi.setSystemTime(new Date(nowMs));

    const finalized = finalizeSession(baseSession(startMs));
    expect(finalized.latencyMs).toBe(3_500);
  });

  it('latencyMs is 0 when started and ended at the same time', () => {
    const t = 1_000_000_000;
    vi.setSystemTime(new Date(t));

    const finalized = finalizeSession(baseSession(t));
    expect(finalized.latencyMs).toBe(0);
  });

  it('preserves sessionId', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = baseSession(1_000_000_000);
    session.sessionId = 'my-unique-id';
    const finalized = finalizeSession(session);
    expect(finalized.sessionId).toBe('my-unique-id');
  });

  it('preserves agentId', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const finalized = finalizeSession(baseSession(1_000_000_000, 'preserve-me'));
    expect(finalized.agentId).toBe('preserve-me');
  });

  it('preserves iterations count', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = { ...baseSession(1_000_000_000), iterations: 7 };
    const finalized = finalizeSession(session);
    expect(finalized.iterations).toBe(7);
  });

  it('preserves toolCallCount', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = { ...baseSession(1_000_000_000), toolCallCount: 12 };
    const finalized = finalizeSession(session);
    expect(finalized.toolCallCount).toBe(12);
  });

  it('preserves totalInputTokens', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = { ...baseSession(1_000_000_000), totalInputTokens: 3_200 };
    const finalized = finalizeSession(session);
    expect(finalized.totalInputTokens).toBe(3_200);
  });

  it('preserves totalOutputTokens', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = { ...baseSession(1_000_000_000), totalOutputTokens: 850 };
    const finalized = finalizeSession(session);
    expect(finalized.totalOutputTokens).toBe(850);
  });

  it('preserves outcome field', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session: AgentSession = { ...baseSession(1_000_000_000), outcome: 'success' };
    const finalized = finalizeSession(session);
    expect(finalized.outcome).toBe('success');
  });

  it('does not mutate the original session object', () => {
    vi.setSystemTime(new Date(1_000_001_000));
    const session = baseSession(1_000_000_000);
    const original = { ...session };
    finalizeSession(session);
    expect(session.endedAt).toBe(original.endedAt);
    expect(session.latencyMs).toBe(original.latencyMs);
  });
});

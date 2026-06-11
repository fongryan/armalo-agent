import { randomUUID } from 'crypto';
import type { AgentSession } from '../types.js';

export function createSession(agentId: string): AgentSession {
  return {
    sessionId: randomUUID(),
    agentId,
    startedAt: new Date(),
    iterations: 0,
    toolCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    latencyMs: 0,
  };
}

export function finalizeSession(session: AgentSession): AgentSession {
  return {
    ...session,
    endedAt: new Date(),
    latencyMs: Date.now() - session.startedAt.getTime(),
  };
}

import { ArmaloClient } from '@armalo/core/client';
import type { PactDefinition } from '@armalo/core';
import type { TrustScoreSnapshot } from '../types.js';

/**
 * Thin wrapper around ArmaloClient for the agent's trust operations:
 * - Register agent on first run
 * - Register pacts
 * - Fetch trust score after each session
 */
export class AgentTrustClient {
  private client: ArmaloClient;
  private agentId: string;

  constructor(apiKey: string, agentId: string, baseUrl?: string) {
    this.client = new ArmaloClient({ apiKey, baseUrl });
    this.agentId = agentId;
  }

  async registerPacts(pacts: PactDefinition[]): Promise<void> {
    for (const pact of pacts) {
      try {
        await this.client.registerPact(pact, this.agentId);
      } catch (err) {
        // Non-fatal: pacts may already be registered
        console.warn(`[armalo] Warning: could not register pact "${pact.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async fetchScore(): Promise<TrustScoreSnapshot | null> {
    try {
      const score = await this.client.getScore(this.agentId);
      return {
        agentId: this.agentId,
        compositeScore: score.composite ?? 0,
        tier: score.certificationTier ?? null,
        dimensions: score.dimensions ?? {},
        confidence: score.confidence ?? 0,
        evaluatedAt: score.computedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async ingestTrace(trace: {
    sessionId: string;
    input: string;
    output: string;
    latencyMs: number;
    toolCallCount: number;
    tokens: { input: number; output: number };
    pactName?: string;
  }): Promise<void> {
    try {
      await this.client.ingestTrace({
        agentId: this.agentId,
        sessionId: trace.sessionId,
        input: trace.input,
        output: trace.output,
        latencyMs: trace.latencyMs,
        toolCallCount: trace.toolCallCount,
        inputTokens: trace.tokens.input,
        outputTokens: trace.tokens.output,
        pactName: trace.pactName,
      });
    } catch {
      // Non-fatal: trace ingest failure should not stop the agent
    }
  }
}

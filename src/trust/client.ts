import { ArmaloClient } from '@armalo/core/client';
import type { PactDefinition } from '@armalo/core';
import type { TrustScoreSnapshot } from '../types.js';

/**
 * Thin wrapper around ArmaloClient for the agent's trust operations:
 * - Register pacts on first run
 * - Fetch trust score after each session
 * - Ingest execution traces for scoring
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
        await this.client.createPact({
          name: pact.name,
          pactType: 'unilateral',
          agentId: this.agentId,
          description: pact.description,
          category: pact.category,
          escrowRequired: pact.escrowRequired,
          escrowAmountUsdc: pact.escrowAmountUsdc,
          conditions: pact.conditions.map((c) => ({
            type: c.type,
            operator: c.operator,
            value: c.value,
            severity: c.severity,
            verificationMethod: c.verificationMethod,
            description: c.description,
          })),
        });
      } catch {
        // Non-fatal: pacts may already be registered (409 conflict is expected on re-runs)
      }
    }
  }

  async fetchScore(): Promise<TrustScoreSnapshot | null> {
    try {
      const score = await this.client.getScore(this.agentId);
      const ext = score as unknown as Record<string, unknown>;
      return {
        agentId: this.agentId,
        compositeScore: score.composite ?? 0,
        tier: (score.certificationTier as TrustScoreSnapshot['tier']) ?? null,
        dimensions: isPlainObject(ext['dimensions'])
          ? (ext['dimensions'] as Record<string, number>)
          : {},
        confidence: typeof ext['confidence'] === 'number' ? ext['confidence'] : 0,
        evaluatedAt: typeof ext['computedAt'] === 'string'
          ? ext['computedAt']
          : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async ingestTrace(trace: {
    sessionId: string;
    latencyMs: number;
    toolCallCount: number;
    tokens: { input: number; output: number };
  }): Promise<void> {
    try {
      const now = Date.now();
      await this.client.ingestTraces({
        agentId: this.agentId,
        runId: trace.sessionId,
        spans: [
          {
            traceId: trace.sessionId,
            spanId: 'root',
            name: 'agent.session',
            status: 'ok',
            startTimeMs: now - trace.latencyMs,
            durationMs: trace.latencyMs,
            attributes: {
              'tool.call_count': trace.toolCallCount,
              'llm.input_tokens': trace.tokens.input,
              'llm.output_tokens': trace.tokens.output,
            },
          },
        ],
      });
    } catch {
      // Non-fatal: trace ingest failure should not stop the agent
    }
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

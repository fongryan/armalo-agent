import type { PactDefinition } from '@armalo/core';

export interface AgentConfig {
  /** Armalo API key — defaults to ARMALO_API_KEY env var */
  armaloApiKey?: string;
  /** Your agent's Armalo ID — defaults to ARMALO_AGENT_ID env var */
  agentId?: string;
  /** Anthropic API key — defaults to ANTHROPIC_API_KEY env var */
  anthropicApiKey?: string;
  /** Claude model (default: claude-opus-4-5) */
  model?: string;
  /** Max tokens per response (default: 8192) */
  maxTokens?: number;
  /** Pacts to register and enforce (default: SAFETY_DEFAULTS) */
  pacts?: PactDefinition[];
  /** Display trust score after each session (default: true) */
  showTrustScore?: boolean;
  /** System prompt override */
  systemPrompt?: string;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentSession {
  sessionId: string;
  agentId: string;
  startedAt: Date;
  endedAt?: Date;
  iterations: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  latencyMs: number;
  outcome?: 'success' | 'error' | 'timeout' | 'stopped';
}

export interface TrustScoreSnapshot {
  agentId: string;
  compositeScore: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | null;
  dimensions: Record<string, number>;
  confidence: number;
  evaluatedAt: string;
}

export interface RunResult {
  output: string;
  session: AgentSession;
  trustScore?: TrustScoreSnapshot;
}

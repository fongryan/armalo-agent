import type { PactDefinition } from '@armalo/core';

export type InferenceContentBlock = {
  type: string;
  [key: string]: unknown;
};

export interface InferenceMessageParam {
  role: 'user' | 'assistant';
  content: string | InferenceContentBlock[];
}

export interface InferenceToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface InferenceCreateParams {
  model: string;
  messages: InferenceMessageParam[];
  max_tokens?: number;
  system?: string;
  tools?: InferenceToolDefinition[];
  [key: string]: unknown;
}

export interface InferenceResponse {
  content: InferenceContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  [key: string]: unknown;
}

export interface InferenceClient {
  messages: {
    create(params: InferenceCreateParams): Promise<InferenceResponse>;
  };
  [key: string]: unknown;
}

export interface AgentConfig {
  /** Armalo API key — defaults to ARMALO_API_KEY env var */
  armaloApiKey?: string;
  /** Your agent's Armalo ID — defaults to ARMALO_AGENT_ID env var */
  agentId?: string;
  /** Anthropic API key for the built-in Claude client. Optional if inferenceClient is provided. */
  anthropicApiKey?: string;
  /** Anthropic-compatible inference client. Use this for OpenAI/Gemini/local/provider-router wrappers. */
  inferenceClient?: InferenceClient;
  /** Model name passed to the configured inference client (default: claude-opus-4-8) */
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
  /** Structured receipt — present when ArmaloAgent is used with receipts: true. */
  receipt?: import('./receipts/index.js').RunReceipt;
}

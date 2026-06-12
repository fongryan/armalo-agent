import type { InferenceClient, InferenceCreateParams, InferenceResponse } from '../types.js';

export interface ProviderProfile {
  name: string;
  label: string;
  envVar?: string;
  requiresApiKey: boolean;
  notes: string;
}

export interface ProviderAttempt {
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ProviderRoute {
  name: string;
  model: string;
  client: InferenceClient;
}

export interface ProviderRouterOptions {
  onAttempt?: (attempt: ProviderAttempt) => void;
}

export type RoutedInferenceResponse = InferenceResponse & {
  provider?: {
    name: string;
    model: string;
    attempts: number;
    history: ProviderAttempt[];
  };
};

export class ProviderChainError extends Error {
  readonly attempts: ProviderAttempt[];

  constructor(attempts: ProviderAttempt[]) {
    super(`All inference providers failed: ${attempts.map((a) => `${a.provider}: ${a.error ?? 'unknown error'}`).join('; ')}`);
    this.name = 'ProviderChainError';
    this.attempts = attempts;
  }
}

export function createFallbackInferenceClient(
  routes: ProviderRoute[],
  options: ProviderRouterOptions = {},
): InferenceClient {
  if (routes.length === 0) {
    throw new Error('createFallbackInferenceClient requires at least one provider route');
  }

  return {
    messages: {
      async create(params: InferenceCreateParams): Promise<RoutedInferenceResponse> {
        const attempts: ProviderAttempt[] = [];

        for (const route of routes) {
          const started = Date.now();
          try {
            const response = await route.client.messages.create({
              ...params,
              model: params.model === 'auto' ? route.model : params.model,
            });
            const attempt = {
              provider: route.name,
              model: route.model,
              ok: true,
              latencyMs: Date.now() - started,
            };
            attempts.push(attempt);
            options.onAttempt?.(attempt);
            return {
              ...response,
              provider: {
                name: route.name,
                model: route.model,
                attempts: attempts.length,
                history: attempts,
              },
            };
          } catch (err) {
            const attempt = {
              provider: route.name,
              model: route.model,
              ok: false,
              latencyMs: Date.now() - started,
              error: err instanceof Error ? err.message : String(err),
            };
            attempts.push(attempt);
            options.onAttempt?.(attempt);
          }
        }

        throw new ProviderChainError(attempts);
      },
    },
  };
}

export function createStaticInferenceClient(provider: string, output: string | Error): InferenceClient {
  return {
    messages: {
      async create(): Promise<InferenceResponse> {
        if (output instanceof Error) throw output;
        return {
          content: [{ type: 'text', text: output }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: output.length },
          model: provider,
        };
      },
    },
  };
}

export function listProviderProfiles(): ProviderProfile[] {
  return [
    {
      name: 'anthropic',
      label: 'Anthropic Claude',
      envVar: 'ANTHROPIC_API_KEY',
      requiresApiKey: true,
      notes: 'Built-in Claude client path for local inference.',
    },
    {
      name: 'openai',
      label: 'OpenAI',
      envVar: 'OPENAI_API_KEY',
      requiresApiKey: true,
      notes: 'Use wrapOpenAI() or an Anthropic-compatible adapter.',
    },
    {
      name: 'gemini',
      label: 'Google Gemini',
      envVar: 'GEMINI_API_KEY',
      requiresApiKey: true,
      notes: 'Use wrapGenAI() or a gateway adapter.',
    },
    {
      name: 'openrouter',
      label: 'OpenRouter / DeepInfra Gateway',
      envVar: 'OPENROUTER_API_KEY',
      requiresApiKey: true,
      notes: 'Good for provider failover and model comparison demos.',
    },
    {
      name: 'local',
      label: 'Local / Ollama-compatible',
      requiresApiKey: false,
      notes: 'Useful for demos that should not require paid provider keys.',
    },
  ];
}

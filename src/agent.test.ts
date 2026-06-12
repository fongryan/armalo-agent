import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InferenceClient } from './types.js';

const mockAnthropicConstructor = vi.hoisted(() => vi.fn());
const mockWrapAnthropic = vi.hoisted(() => vi.fn((client: unknown) => client));

vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropicConstructor,
}));

vi.mock('@armalo/integrations', () => ({
  wrapAnthropic: mockWrapAnthropic,
}));

vi.mock('@armalo/core/validator', () => ({
  validateLocally: vi.fn().mockResolvedValue({ compliant: true, results: [] }),
}));

import { TrustNativeAgent } from './agent.js';

function fakeInferenceClient(output = 'hello from a custom provider'): InferenceClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: output }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    },
  };
}

describe('TrustNativeAgent provider configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['AGENT_MODEL'];
    delete process.env['AGENT_MAX_TOKENS'];
    mockAnthropicConstructor.mockImplementation(() => fakeInferenceClient('hello from anthropic'));
  });

  it('does not require ANTHROPIC_API_KEY during construction or initialization', async () => {
    const agent = new TrustNativeAgent({ showTrustScore: false });

    await expect(agent.initialize()).resolves.toBeUndefined();
    expect(mockAnthropicConstructor).not.toHaveBeenCalled();
  });

  it('fails at run time with provider-neutral guidance when no inference provider is configured', async () => {
    const agent = new TrustNativeAgent({ showTrustScore: false });

    await expect(agent.run('hello')).rejects.toThrow(/No local inference provider is configured/);
  });

  it('runs with an injected Anthropic-compatible inference client', async () => {
    const inferenceClient = fakeInferenceClient('custom client response');
    const agent = new TrustNativeAgent({ inferenceClient, showTrustScore: false });

    const result = await agent.run('hello');

    expect(result.output).toBe('custom client response');
    expect(inferenceClient.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
    }));
    expect(mockAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockWrapAnthropic).toHaveBeenCalledWith(inferenceClient, expect.objectContaining({
      agentId: 'armalo-agent-local',
    }));
  });

  it('uses ANTHROPIC_API_KEY for the built-in Claude client when provided', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const agent = new TrustNativeAgent({ showTrustScore: false });

    const result = await agent.run('hello');

    expect(result.output).toBe('hello from anthropic');
    expect(mockAnthropicConstructor).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' });
  });

  it('falls back to the default max tokens when AGENT_MAX_TOKENS is invalid', async () => {
    process.env['AGENT_MAX_TOKENS'] = 'not-a-number';
    const inferenceClient = fakeInferenceClient();
    const agent = new TrustNativeAgent({ inferenceClient, showTrustScore: false });

    await agent.run('hello');

    expect(inferenceClient.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      max_tokens: 8192,
    }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createFallbackInferenceClient, createStaticInferenceClient, listProviderProfiles } from './index.js';

describe('provider router', () => {
  it('falls through failed providers and returns the first successful response with metadata', async () => {
    const first = createStaticInferenceClient('anthropic', new Error('quota exceeded'));
    const second = createStaticInferenceClient('openai', 'hello from openai');
    const router = createFallbackInferenceClient([
      { name: 'anthropic', model: 'claude-opus-4-8', client: first },
      { name: 'openai', model: 'gpt-4.1', client: second },
    ]);

    const response = await router.messages.create({
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(response.content[0]?.['text']).toBe('hello from openai');
    expect(response.provider).toEqual(expect.objectContaining({ name: 'openai', model: 'gpt-4.1', attempts: 2 }));
  });

  it('throws a provider-chain error with every attempt when all providers fail', async () => {
    const router = createFallbackInferenceClient([
      { name: 'a', model: 'a-model', client: createStaticInferenceClient('a', new Error('bad a')) },
      { name: 'b', model: 'b-model', client: createStaticInferenceClient('b', new Error('bad b')) },
    ]);

    await expect(router.messages.create({ model: 'auto', messages: [] })).rejects.toMatchObject({
      name: 'ProviderChainError',
      attempts: [
        expect.objectContaining({ provider: 'a', ok: false }),
        expect.objectContaining({ provider: 'b', ok: false }),
      ],
    });
  });

  it('exposes public provider profile guidance without requiring secrets', () => {
    const profiles = listProviderProfiles();

    expect(profiles.map((p) => p.name)).toEqual(expect.arrayContaining(['anthropic', 'openai', 'gemini', 'openrouter', 'local']));
    expect(profiles.every((p) => p.requiresApiKey === false || p.envVar)).toBe(true);
  });

  it('invokes the attempt callback with latency and status', async () => {
    const onAttempt = vi.fn();
    const router = createFallbackInferenceClient([
      { name: 'local', model: 'llama', client: createStaticInferenceClient('local', 'ok') },
    ], { onAttempt });

    await router.messages.create({ model: 'auto', messages: [] });

    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'local',
      model: 'llama',
      ok: true,
      latencyMs: expect.any(Number),
    }));
  });
});

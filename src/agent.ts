/**
 * TrustNativeAgent — the core of armalo-agent.
 *
 * Wraps an injected Anthropic-compatible client or the built-in Claude client with:
 * - Behavioral pacts via @armalo/core
 * - Trust telemetry via @armalo/integrations
 * - Tool-use loop with 5 built-in tools
 * - Automatic trust score display after each session
 *
 * Usage:
 *   const agent = new TrustNativeAgent({ armaloApiKey, agentId });
 *   const result = await agent.run('What is the population of Tokyo?');
 *   console.log(result.output);
 */

import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropic } from '@armalo/integrations';
import type { PactDefinition } from '@armalo/core';
import { validateLocally } from '@armalo/core/validator';
import type { AgentConfig, Tool, RunResult, AgentSession, InferenceClient } from './types.js';
import { SAFETY_DEFAULTS } from './pacts/index.js';
import { ALL_TOOLS, toAnthropicTools, findTool } from './tools/registry.js';
import { AgentTrustClient } from './trust/client.js';
import { printTrustScore } from './trust/score.js';
import { createSession, finalizeSession } from './trust/session.js';

// Local content-block types that are compatible with both the Armalo wrapper
// and the Anthropic SDK. The wrapper uses a generic `{ type: string; [k]: unknown }`
// shape; we extend it with the concrete fields we actually read.
type ArmaloBlock = { type: string; [key: string]: unknown };
type ArmaloToolUseBlock = ArmaloBlock & { id: string; name: string; input: Record<string, unknown> };
type ArmaloToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type ArmaloMessageParam = { role: 'user' | 'assistant'; content: string | ArmaloBlock[] };

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools for searching the web, reading URLs, running code, doing math, and storing memory across turns.

Guidelines:
- Use tools proactively to find accurate, up-to-date information
- Cite sources when making factual claims
- Admit uncertainty rather than confabulating
- Be concise but thorough
- When you've completed the task, provide a clear final answer`;

const DEFAULT_MODEL = 'claude-opus-4-5';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_ITERATIONS = 20;

export class TrustNativeAgent {
  private config: Required<Omit<AgentConfig, 'systemPrompt' | 'inferenceClient'>> & {
    systemPrompt: string;
    inferenceClient?: InferenceClient;
  };
  private inferenceClient?: InferenceClient;
  private trustClient: AgentTrustClient | null = null;
  private pacts: PactDefinition[];
  private tools: Tool[];

  constructor(config: AgentConfig = {}) {
    const armaloApiKey = config.armaloApiKey ?? process.env.ARMALO_API_KEY ?? '';
    const agentId = config.agentId ?? process.env.ARMALO_AGENT_ID ?? 'armalo-agent-local';
    const anthropicApiKey = config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';

    this.config = {
      armaloApiKey,
      agentId,
      anthropicApiKey,
      inferenceClient: config.inferenceClient,
      model: config.model ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL,
      maxTokens: config.maxTokens ?? readPositiveInt(process.env.AGENT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
      pacts: config.pacts ?? [SAFETY_DEFAULTS],
      showTrustScore: config.showTrustScore ?? process.env.SHOW_TRUST_SCORE !== 'false',
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    };

    this.inferenceClient = this.buildInferenceClient(config.inferenceClient, anthropicApiKey, armaloApiKey, agentId);

    if (armaloApiKey && agentId !== 'armalo-agent-local') {
      this.trustClient = new AgentTrustClient(
        armaloApiKey,
        agentId,
        process.env.ARMALO_BASE_URL,
      );
    }

    this.pacts = this.config.pacts;
    this.tools = ALL_TOOLS;
  }

  /** Register pacts with Armalo on startup */
  async initialize(): Promise<void> {
    if (this.trustClient) {
      await this.trustClient.registerPacts(this.pacts);
    }
  }

  /** Run the agent on a user message, executing tools until a final response */
  async run(userMessage: string, options: { tools?: Tool[] } = {}): Promise<RunResult> {
    const tools = options.tools ?? this.tools;
    const session = createSession(this.config.agentId);

    const messages: ArmaloMessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    let finalOutput = '';
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const inferenceClient = this.requireInferenceClient();
      const response = await inferenceClient.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.config.systemPrompt,
        tools: toAnthropicTools(tools),
        messages,
      });

      session.totalInputTokens += response.usage.input_tokens;
      session.totalOutputTokens += response.usage.output_tokens;
      session.iterations = iteration;

      const content = response.content as ArmaloBlock[];

      if (response.stop_reason === 'end_turn') {
        // Agent is done — extract text output
        for (const block of content) {
          if (block.type === 'text') {
            finalOutput += block['text'] as string;
          }
        }
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Execute all requested tools in parallel
        const toolUseBlocks = content.filter((b): b is ArmaloToolUseBlock =>
          b.type === 'tool_use' && typeof b['id'] === 'string' && typeof b['name'] === 'string',
        );
        session.toolCallCount += toolUseBlocks.length;

        messages.push({ role: 'assistant', content });

        const toolResults = await Promise.all(
          toolUseBlocks.map((toolUse) => executeTool(toolUse, tools)),
        );

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop reason
      break;
    }

    const finalSession = finalizeSession({
      ...session,
      outcome: finalOutput ? 'success' : 'error',
    });

    // Validate output locally against pacts
    await this.validateAgainstPacts(userMessage, finalOutput, finalSession);

    // Ingest trace to Armalo for trust scoring
    if (this.trustClient) {
      await this.trustClient.ingestTrace({
        sessionId: finalSession.sessionId,
        latencyMs: finalSession.latencyMs,
        toolCallCount: finalSession.toolCallCount,
        tokens: {
          input: finalSession.totalInputTokens,
          output: finalSession.totalOutputTokens,
        },
      });
    }

    // Fetch and display trust score
    let trustScore;
    if (this.trustClient && this.config.showTrustScore) {
      trustScore = await this.trustClient.fetchScore() ?? undefined;
      if (trustScore) {
        printTrustScore(trustScore);
      }
    }

    return { output: finalOutput, session: finalSession, trustScore };
  }

  private buildInferenceClient(
    configuredClient: InferenceClient | undefined,
    anthropicApiKey: string,
    armaloApiKey: string,
    agentId: string,
  ): InferenceClient | undefined {
    if (configuredClient) {
      return wrapAnthropic(configuredClient as unknown as Parameters<typeof wrapAnthropic>[0], {
        apiKey: armaloApiKey,
        agentId,
        baseUrl: process.env.ARMALO_BASE_URL,
      }) as unknown as InferenceClient;
    }

    if (!anthropicApiKey) return undefined;

    // Wrap the Anthropic client with Armalo trust telemetry (2 lines).
    // Cast to satisfy the wrapper's AnthropicLike type — the Anthropic SDK's streaming
    // overloads have a stricter signature than the wrapper expects.
    const rawClient = new Anthropic({ apiKey: anthropicApiKey });
    return wrapAnthropic(rawClient as unknown as Parameters<typeof wrapAnthropic>[0], {
      apiKey: armaloApiKey,
      agentId,
      baseUrl: process.env.ARMALO_BASE_URL,
    }) as unknown as InferenceClient;
  }

  private requireInferenceClient(): InferenceClient {
    if (this.inferenceClient) return this.inferenceClient;
    throw new Error(
      'No local inference provider is configured. Set ANTHROPIC_API_KEY for the built-in Claude client, pass TrustNativeAgent({ inferenceClient }) for another provider, or use the Armalo CLI hosted inference flow.',
    );
  }

  private async validateAgainstPacts(
    input: string,
    output: string,
    session: AgentSession,
  ): Promise<void> {
    for (const pact of this.pacts) {
      try {
        const result = await validateLocally(pact, {
          input,
          output,
          latencyMs: session.latencyMs,
          tokenCount: session.totalOutputTokens,
        });
        if (!result.compliant) {
          const violations = result.results
            .filter((c) => !c.passed && !c.skipped)
            .map((c) => `${c.type}: ${c.details ?? 'failed'}`)
            .join(', ');
          console.warn(`[armalo] Pact "${pact.name}" violations: ${violations}`);
        }
      } catch {
        // validateLocally is best-effort
      }
    }
  }

  /** Add custom tools to the agent */
  addTool(tool: Tool): this {
    this.tools = [...this.tools, tool];
    return this;
  }

  /** Replace the full tool set */
  setTools(tools: Tool[]): this {
    this.tools = tools;
    return this;
  }

  /** Replace active pacts */
  setPacts(pacts: PactDefinition[]): this {
    this.pacts = pacts;
    return this;
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function executeTool(
  toolUse: ArmaloToolUseBlock,
  tools: Tool[],
): Promise<ArmaloToolResultBlock> {
  const tool = findTool(toolUse.name, tools);

  if (!tool) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Error: Unknown tool "${toolUse.name}"`,
      is_error: true,
    };
  }

  try {
    const result = await tool.execute(toolUse.input);
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    };
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Error executing ${toolUse.name}: ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
// Run directly: `npx tsx src/agent.ts` or `npm run dev`

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const { createInterface } = await import('readline');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const agent = new TrustNativeAgent();
  await agent.initialize();

  console.log('');
  console.log('\x1b[1mArmalo Agent\x1b[0m — trust-native AI assistant');
  console.log('\x1b[2mType your message and press Enter. Ctrl+C to exit.\x1b[0m');
  console.log('');

  const ask = (): void => {
    rl.question('\x1b[32m> \x1b[0m', async (input) => {
      const message = input.trim();
      if (!message) { ask(); return; }
      if (message === '/exit' || message === '/quit') { rl.close(); return; }

      try {
        const result = await agent.run(message);
        console.log('');
        console.log(result.output);
        console.log('');
        console.log(`\x1b[2m[${result.session.iterations} turns · ${result.session.toolCallCount} tool calls · ${result.session.totalInputTokens + result.session.totalOutputTokens} tokens]\x1b[0m`);
      } catch (err) {
        console.error('\x1b[31mError:\x1b[0m', err instanceof Error ? err.message : String(err));
      }

      ask();
    });
  };

  ask();
}

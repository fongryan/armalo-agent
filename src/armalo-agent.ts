/**
 * ArmaloAgent — the flagship class advertised in the blog posts.
 *
 * Drop-in upgrade from TrustNativeAgent with:
 * - Single `pact` option (from PactBuilder or a PactDefinition directly)
 * - Per-action pact enforcement BEFORE tool calls execute (not just post-run)
 * - `receipts: true` option — result.receipt contains every action and clause evaluation
 *
 * @example
 * ```typescript
 * import { ArmaloAgent, PactBuilder } from 'armalo-agent';
 *
 * const pact = new PactBuilder()
 *   .from('SAFETY_DEFAULTS')
 *   .deny('tool:file_write', { pathMatches: /\/etc\// })
 *   .deny('tool:http_request', { urlMatches: /prod\.internal/ })
 *   .require('citation_verified', { on: 'output:contains_url' })
 *   .build();
 *
 * const agent = new ArmaloAgent({
 *   model: 'claude-opus-4-8',
 *   pact,
 *   receipts: true,
 * });
 *
 * const result = await agent.run(userInput);
 * // result.receipt — every action, every clause evaluation, every outcome
 * console.log(result.receipt?.id);
 * ```
 */

import type { PactDefinition } from '@armalo/core';
import { TrustNativeAgent } from './agent.js';
import type { AgentConfig, RunResult, Tool } from './types.js';
import { createRunReceipt } from './receipts/index.js';
import type { RunReceipt, ReceiptToolCall } from './receipts/index.js';
import { isBuiltPact, matchesDenyRule } from './pact-builder.js';
import type { BuiltPact, DenyRule } from './pact-builder.js';

export interface ArmaloAgentConfig extends Omit<AgentConfig, 'pacts'> {
  /**
   * A single pact (from PactBuilder or definePact). Converted to a pacts array internally.
   * Use PactBuilder to compose pacts with per-action deny/require rules.
   */
  pact?: PactDefinition | BuiltPact;
  /**
   * Also accepts an array for multi-pact configurations.
   */
  pacts?: PactDefinition[];
  /**
   * When true, result.receipt contains a structured record of every tool call,
   * pact clause evaluation, and outcome. Default: false.
   */
  receipts?: boolean;
}

export interface ArmaloRunResult extends RunResult {
  /** Structured post-run receipt. Present only when `receipts: true` was set in config. */
  receipt?: RunReceipt;
}

interface PactViolationRecord {
  toolName: string;
  rule: DenyRule;
  blockedAt: string;
}

export class ArmaloAgent extends TrustNativeAgent {
  private readonly _denyRules: readonly DenyRule[];
  private readonly _generateReceipts: boolean;
  private _toolCallLog: ReceiptToolCall[] = [];
  private _violations: PactViolationRecord[] = [];
  private _runStartedAt = '';

  constructor(config: ArmaloAgentConfig = {}) {
    const { pact, pacts, receipts, ...rest } = config;

    const effectivePacts: PactDefinition[] = [];
    if (pact) effectivePacts.push(pact);
    if (pacts) effectivePacts.push(...pacts);

    super({ ...rest, pacts: effectivePacts.length > 0 ? effectivePacts : undefined });

    this._denyRules = isBuiltPact(pact) ? pact._denyRules : [];
    this._generateReceipts = receipts ?? false;
  }

  /**
   * Pre-execution gate. Checked before every tool call in the run loop.
   * Hard deny rules block execution and return an error result to the model.
   * Soft deny rules log a warning and allow the call through.
   */
  protected override async beforeToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<{ blocked: true; reason: string } | null> {
    for (const rule of this._denyRules) {
      if (matchesDenyRule(rule, toolName, toolInput)) {
        this._violations.push({
          toolName,
          rule,
          blockedAt: new Date().toISOString(),
        });

        if (rule.enforcement === 'hard') {
          return {
            blocked: true,
            reason: `Pact deny rule blocked "${rule.toolPattern}"${rule.pathMatches ? ` (path: ${rule.pathMatches})` : ''}${rule.urlMatches ? ` (url: ${rule.urlMatches})` : ''}`,
          };
        }

        console.warn(
          `[armalo:pact] Soft deny rule matched tool "${toolName}" against pattern "${rule.toolPattern}" — allowed (soft enforcement)`,
        );
      }
    }
    return null;
  }

  /** Accumulates tool call evidence for the receipt. */
  protected override onToolCallComplete(toolName: string, durationMs: number, error: boolean): void {
    if (this._generateReceipts) {
      this._toolCallLog.push({
        name: toolName,
        status: error ? 'failed' : 'passed',
        durationMs,
      });
    }
  }

  /** Run the agent and optionally attach a structured receipt to the result. */
  override async run(
    userMessage: string,
    options: { tools?: Tool[] } = {},
  ): Promise<ArmaloRunResult> {
    this._toolCallLog = [];
    this._violations = [];
    this._runStartedAt = new Date().toISOString();

    const result = await super.run(userMessage, options);

    if (!this._generateReceipts) return result;

    const receipt = createRunReceipt({
      agentId: result.session.agentId,
      title: userMessage.length > 80 ? `${userMessage.slice(0, 77)}...` : userMessage,
      prompt: userMessage,
      provider: { name: 'armalo-agent', model: this.config.model },
      pacts: this.pacts.map((p) => ({ name: p.name, version: String(p.version ?? 1) })),
      toolCalls: this._toolCallLog,
      evidence: this._violations.map((v) => ({
        kind: 'eval' as const,
        label: `Pact deny: ${v.rule.toolPattern}`,
        status: 'failed' as const,
        summary: `Tool "${v.toolName}" blocked by pact rule at ${v.blockedAt}`,
      })),
      result: {
        status: result.output ? 'passed' : 'failed',
        summary: result.output.slice(0, 400) || '[No output]',
      },
      startedAt: this._runStartedAt,
      completedAt: result.session.endedAt?.toISOString() ?? new Date().toISOString(),
      metadata: {
        iterations: result.session.iterations,
        toolCallCount: result.session.toolCallCount,
        blockedToolCalls: this._violations.length,
        inputTokens: result.session.totalInputTokens,
        outputTokens: result.session.totalOutputTokens,
      },
    });

    return { ...result, receipt };
  }

  /** Quick-access to configured deny rules (for introspection/testing). */
  getDenyRules(): readonly DenyRule[] {
    return this._denyRules;
  }

  /** Returns active pact definitions (same as the protected property, exposed for ArmaloAgent users). */
  getActivePacts(): PactDefinition[] {
    return [...this.pacts];
  }
}

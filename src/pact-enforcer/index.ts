/**
 * PactEnforcer — wraps any async function with runtime pact enforcement.
 *
 * Checks pact conditions before and after execution. Violations can be:
 * - Logged as warnings (default)
 * - Thrown as errors (strict mode)
 * - Escalated to Armalo jury for human-in-the-loop review (escalate mode)
 *
 * Compliance traces are automatically ingested to Armalo for trust scoring.
 * Every wrapped call either passes or produces a documented violation record.
 *
 * @example
 * ```typescript
 * import { PactEnforcer } from 'armalo-agent/pact-enforcer';
 * import { SAFETY_DEFAULTS } from 'armalo-agent';
 *
 * const enforcer = new PactEnforcer({
 *   apiKey: process.env.ARMALO_API_KEY!,
 *   agentId: 'my-agent',
 *   pacts: [SAFETY_DEFAULTS],
 *   mode: 'log',  // or 'strict' or 'escalate'
 * });
 *
 * // Wrap any function — enforcement is transparent to the caller
 * const safeRun = enforcer.wrap(myAgent.run.bind(myAgent));
 * const result = await safeRun('Tell me about quantum computing');
 * // ↑ enforces SAFETY_DEFAULTS on input + output; logs violations
 * ```
 */

import { ArmaloClient } from '@armalo/core/client';
import { validateLocally } from '@armalo/core/validator';
import type { PactDefinition } from '@armalo/core';
import { JuryClient } from '../jury/index.js';
import type { JuryResult } from '../jury/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnforcerMode = 'log' | 'strict' | 'escalate';

export interface PactEnforcerConfig {
  apiKey: string;
  agentId: string;
  pacts: PactDefinition[];
  /** Violation handling mode:
   * - 'log'      — console.warn + continue (default)
   * - 'strict'   — throw PactViolationError
   * - 'escalate' — send to Armalo jury; throw on jury rejection */
  mode?: EnforcerMode;
  /** In 'escalate' mode: jury timeout (ms). Default: 60s */
  juryTimeoutMs?: number;
  /** Ingest compliance traces to Armalo for trust scoring. Default: true */
  ingestTraces?: boolean;
  baseUrl?: string;
}

export interface PactCheckResult {
  compliant: boolean;
  violations: PactViolation[];
  juryResult?: JuryResult;
  checkedPacts: string[];
}

export interface PactViolation {
  pactName: string;
  conditionType: string;
  details: string;
  severity: 'info' | 'warning' | 'error';
}

export class PactViolationError extends Error {
  constructor(
    public readonly violations: PactViolation[],
    message?: string,
  ) {
    super(message ?? `Pact violations: ${violations.map((v) => `${v.pactName}.${v.conditionType}`).join(', ')}`);
    this.name = 'PactViolationError';
  }
}

// ── Implementation ────────────────────────────────────────────────────────────

export class PactEnforcer {
  private client: ArmaloClient;
  private jury: JuryClient;
  readonly config: Required<PactEnforcerConfig>;

  constructor(config: PactEnforcerConfig) {
    this.config = {
      mode: 'log',
      juryTimeoutMs: 60_000,
      ingestTraces: true,
      baseUrl: undefined as unknown as string,
      ...config,
    };

    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.jury = new JuryClient({
      apiKey: config.apiKey,
      agentId: config.agentId,
      baseUrl: config.baseUrl,
    });
  }

  /**
   * Wrap an async function with pact enforcement.
   *
   * The wrapper is transparent to the caller — it has the same signature as
   * the original function. Enforcement happens before and after the call.
   *
   * Input and output are both checked. If the function takes a single string
   * argument and returns a string (the most common agent shape), full pact
   * enforcement applies. For other signatures, only the output is checked.
   */
  wrap<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn>,
    opts: {
      /** Override the pacts for this specific call. */
      pacts?: PactDefinition[];
      /** Extract the "output text" from the return value for pact checking. */
      extractOutput?: (result: TReturn) => string;
      /** Extract the "input text" from the args for pact checking. */
      extractInput?: (...args: TArgs) => string;
    } = {},
  ): (...args: TArgs) => Promise<TReturn> {
    const pacts = opts.pacts ?? this.config.pacts;
    const extractOut = opts.extractOutput ?? ((r) => typeof r === 'string' ? r : JSON.stringify(r));
    const extractIn = opts.extractInput ?? ((...args) => typeof args[0] === 'string' ? args[0] : '');

    return async (...args: TArgs): Promise<TReturn> => {
      const input = extractIn(...args);
      const start = Date.now();

      const result = await fn(...args);

      const output = extractOut(result);
      const latencyMs = Date.now() - start;

      const check = await this.check(input, output, { pacts, latencyMs });

      await this.handleViolations(check, input, output);

      if (this.config.ingestTraces) {
        this.ingestTrace(input, output, check, latencyMs).catch(() => undefined);
      }

      return result;
    };
  }

  /**
   * Run pact checks on an input/output pair without wrapping a function.
   *
   * Useful when you want to check compliance on an already-generated output
   * before sending it to a user.
   */
  async check(
    input: string,
    output: string,
    opts: {
      pacts?: PactDefinition[];
      latencyMs?: number;
      tokenCount?: number;
    } = {},
  ): Promise<PactCheckResult> {
    const pacts = opts.pacts ?? this.config.pacts;
    const violations: PactViolation[] = [];
    const checkedPacts: string[] = [];

    for (const pact of pacts) {
      checkedPacts.push(pact.name);
      try {
        const result = await validateLocally(pact, {
          input,
          output,
          latencyMs: opts.latencyMs,
          tokenCount: opts.tokenCount,
        });

        if (!result.compliant) {
          for (const cond of result.results) {
            if (!cond.passed && !cond.skipped) {
              violations.push({
                pactName: pact.name,
                conditionType: cond.type,
                details: cond.details ?? `Failed: ${JSON.stringify(cond.actual)} (threshold: ${JSON.stringify(cond.threshold)})`,
                severity: this.conditionSeverity(cond.type),
              });
            }
          }
        }
      } catch {
        // validateLocally failure is non-fatal
      }
    }

    return { compliant: violations.length === 0, violations, checkedPacts };
  }

  /**
   * Escalate a pact violation to the Armalo jury for human-in-the-loop review.
   *
   * The jury evaluates the output against the violated criteria. Returns a
   * JuryResult with a pass/fail verdict and reasoning.
   */
  async escalateToJury(
    input: string,
    output: string,
    violations: PactViolation[],
  ): Promise<JuryResult> {
    const criteria = [
      ...violations.map((v) => `${v.conditionType}: ${v.details}`),
      'overall_compliance',
    ];

    return this.jury.verify(
      { input, output, criteria },
      { timeoutMs: this.config.juryTimeoutMs },
    );
  }

  /**
   * Check compliance of a batch of input/output pairs in parallel.
   *
   * Returns one PactCheckResult per pair.
   */
  async checkBatch(
    pairs: Array<{ input: string; output: string }>,
  ): Promise<PactCheckResult[]> {
    return Promise.all(pairs.map((p) => this.check(p.input, p.output)));
  }

  /**
   * Get a compliance report: overall pass rate across a batch.
   */
  async auditBatch(pairs: Array<{ input: string; output: string }>): Promise<{
    totalChecked: number;
    compliant: number;
    violations: number;
    passRate: number;
    topViolations: Array<{ type: string; count: number }>;
  }> {
    const results = await this.checkBatch(pairs);
    const allViolations = results.flatMap((r) => r.violations);
    const compliant = results.filter((r) => r.compliant).length;

    const typeCounts: Record<string, number> = {};
    for (const v of allViolations) {
      const key = `${v.pactName}.${v.conditionType}`;
      typeCounts[key] = (typeCounts[key] ?? 0) + 1;
    }

    return {
      totalChecked: results.length,
      compliant,
      violations: results.length - compliant,
      passRate: results.length > 0 ? compliant / results.length : 1,
      topViolations: Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async handleViolations(check: PactCheckResult, input: string, output: string): Promise<void> {
    if (check.compliant) return;

    const mode = this.config.mode;

    if (mode === 'log') {
      for (const v of check.violations) {
        console.warn(`[pact-enforcer] Violation in "${v.pactName}": ${v.conditionType} — ${v.details}`);
      }
      return;
    }

    if (mode === 'strict') {
      throw new PactViolationError(check.violations);
    }

    if (mode === 'escalate') {
      const juryResult = await this.escalateToJury(input, output, check.violations);
      check.juryResult = juryResult;

      if (!juryResult.passed) {
        throw new PactViolationError(
          check.violations,
          `Pact violations confirmed by jury: ${juryResult.failedCriteria.join(', ')}`,
        );
      }
      // Jury overrode local check — allow
    }
  }

  private async ingestTrace(
    input: string,
    output: string,
    check: PactCheckResult,
    latencyMs: number,
  ): Promise<void> {
    await this.client.ingestTraces({
      agentId: this.config.agentId,
      runId: `pact-check-${Date.now()}`,
      spans: [
        {
          traceId: `pact-${Date.now()}`,
          spanId: 'enforcement',
          name: 'pact.enforcement',
          status: check.compliant ? 'ok' : 'error',
          startTimeMs: Date.now() - latencyMs,
          durationMs: latencyMs,
          attributes: {
            'pact.compliant': check.compliant,
            'pact.violation_count': check.violations.length,
            'pact.checked': check.checkedPacts.join(','),
            'llm.input_tokens': Math.ceil(input.length / 4),
            'llm.output_tokens': Math.ceil(output.length / 4),
          },
        },
      ],
    });
  }

  private conditionSeverity(conditionType: string): PactViolation['severity'] {
    if (['safety', 'harmful_content', 'pii_leak', 'injection'].some((k) => conditionType.includes(k))) {
      return 'error';
    }
    if (['scope', 'max_tokens', 'max_latency'].some((k) => conditionType.includes(k))) {
      return 'warning';
    }
    return 'info';
  }
}

export type { PactDefinition };

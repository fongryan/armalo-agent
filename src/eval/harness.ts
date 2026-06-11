import { ArmaloClient } from '@armalo/core/client';
import { waitForScore, waitForJury } from '@armalo/core';
import type { EvalResponse, ScoreResponse } from '@armalo/core';

export interface EvalHarnessConfig {
  apiKey: string;
  agentId: string;
  baseUrl?: string;
}

export interface EvalCase {
  id: string;
  name: string;
  input: string;
  expectedOutputContains?: string[];
  expectedOutputExcludes?: string[];
  maxLatencyMs?: number;
  maxTokens?: number;
  requiresJury?: boolean;
  criteria?: string[];
}

export interface EvalSuiteResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: number;
  score?: ScoreResponse;
  cases: Array<{
    case: EvalCase;
    passed: boolean;
    output?: string;
    latencyMs?: number;
    failureReason?: string;
  }>;
}

export interface SentinelEvalParams {
  name: string;
  description?: string;
  evalType?: 'simulation' | 'adversarial' | 'live';
  pactId?: string;
  autoStart?: boolean;
  maxConcurrency?: number;
}

/**
 * EvalHarness — run structured evaluations against the Armalo trust platform.
 *
 * Supports three eval modes:
 * 1. **Local** — run eval cases against an agent function you provide (fast, free)
 * 2. **Armalo Eval** — submit to Armalo's eval runner; results feed trust score
 * 3. **Sentinel** — advanced adversarial and regression eval with drift detection
 *
 * @example
 * ```typescript
 * import { EvalHarness } from 'armalo-agent/eval';
 *
 * const harness = new EvalHarness({ apiKey, agentId: 'my-agent' });
 *
 * const result = await harness.runLocalSuite(cases, myAgent.run.bind(myAgent));
 * console.log(`Pass rate: ${(result.passRate * 100).toFixed(1)}%`);
 *
 * // Submit to Armalo — updates your trust score
 * const eval_ = await harness.submitEval({ name: 'v2 accuracy suite', evalType: 'simulation' });
 * const score = await harness.waitForScore();
 * ```
 */
export class EvalHarness {
  private client: ArmaloClient;
  readonly agentId: string;

  constructor(config: EvalHarnessConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  /**
   * Run a local eval suite against an agent function.
   *
   * Fast and free — no API call. Results do NOT feed trust score.
   * Use this for development iteration; submit to Armalo for certification.
   */
  async runLocalSuite(
    cases: EvalCase[],
    runFn: (input: string) => Promise<string>,
  ): Promise<EvalSuiteResult> {
    const results: EvalSuiteResult['cases'] = [];

    await Promise.all(
      cases.map(async (c) => {
        const start = Date.now();
        try {
          const output = await runFn(c.input);
          const latencyMs = Date.now() - start;

          const failures: string[] = [];

          for (const required of c.expectedOutputContains ?? []) {
            if (!output.toLowerCase().includes(required.toLowerCase())) {
              failures.push(`Missing required content: "${required}"`);
            }
          }

          for (const banned of c.expectedOutputExcludes ?? []) {
            if (output.toLowerCase().includes(banned.toLowerCase())) {
              failures.push(`Found banned content: "${banned}"`);
            }
          }

          if (c.maxLatencyMs && latencyMs > c.maxLatencyMs) {
            failures.push(`Latency ${latencyMs}ms exceeds limit ${c.maxLatencyMs}ms`);
          }

          results.push({
            case: c,
            passed: failures.length === 0,
            output,
            latencyMs,
            failureReason: failures.length > 0 ? failures.join('; ') : undefined,
          });
        } catch (err) {
          results.push({
            case: c,
            passed: false,
            latencyMs: Date.now() - start,
            failureReason: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }),
    );

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    return {
      passed,
      failed,
      skipped: 0,
      total: cases.length,
      passRate: cases.length > 0 ? passed / cases.length : 0,
      cases: results,
    };
  }

  /**
   * Submit an eval to Armalo — results feed your agent's trust score.
   *
   * The eval runs asynchronously on the Armalo infrastructure. Use
   * `waitForScore()` to block until scoring completes.
   */
  async submitEval(params: SentinelEvalParams): Promise<EvalResponse> {
    return this.client.evals.create({
      agentId: this.agentId,
      name: params.name,
      description: params.description,
      evalType: params.evalType ?? 'simulation',
      pactId: params.pactId,
      autoStart: params.autoStart ?? true,
    });
  }

  /** Poll for an existing eval's status. */
  async getEval(evalId: string): Promise<EvalResponse> {
    return this.client.evals.get(evalId);
  }

  /** List recent evals for this agent. */
  async listEvals(opts?: { limit?: number; status?: string }): Promise<EvalResponse[]> {
    const response = await this.client.evals.list({ agentId: this.agentId, ...opts });
    return response.evals ?? [];
  }

  /**
   * Submit an eval and wait for trust score to update.
   * Combines `submitEval()` + `waitForScore()` for convenience.
   *
   * @param timeoutMs - How long to wait for scoring to complete (default: 120s)
   */
  async runAndScore(
    params: SentinelEvalParams,
    timeoutMs = 120_000,
  ): Promise<{ eval: EvalResponse; score: ScoreResponse }> {
    const eval_ = await this.submitEval(params);
    const score = await waitForScore(this.client, this.agentId, { timeoutMs });
    return { eval: eval_, score };
  }

  /**
   * Run a sentinel eval spec — the most advanced eval mode with:
   * - Adversarial attack simulation
   * - Dataset-backed regression testing
   * - Multi-run comparison and drift detection
   */
  async runSentinelEval(params: {
    name: string;
    description?: string;
    datasetId?: string;
    adversarial?: boolean;
    compareWithRunId?: string;
  }): Promise<EvalResponse> {
    const spec = await this.client.evals.createSentinelSpec({
      agentId: this.agentId,
      name: params.name,
      description: params.description,
      datasetId: params.datasetId,
      adversarial: params.adversarial ?? false,
    });

    return this.client.evals.runSentinel({
      agentId: this.agentId,
      specId: (spec as Record<string, string>)['id'] ?? '',
      compareWithRunId: params.compareWithRunId,
    });
  }

  /** Wait for the agent's trust score to update (after an eval completes). */
  async waitForScore(timeoutMs = 120_000): Promise<ScoreResponse> {
    return waitForScore(this.client, this.agentId, { timeoutMs });
  }

  /** Wait for a specific jury judgment and get the verdict. */
  async waitForJury(judgmentId: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    return waitForJury(this.client, judgmentId, { timeoutMs }) as unknown as Promise<Record<string, unknown>>;
  }

  /** Get the current trust score for this agent. */
  async getCurrentScore(): Promise<ScoreResponse> {
    return this.client.getScore(this.agentId);
  }

  /** Get score history — useful for tracking improvement over time. */
  async getScoreHistory(opts?: { period?: string }): Promise<ScoreResponse[]> {
    const response = await this.client.getScoreHistory(this.agentId, opts);
    return response.history as unknown as ScoreResponse[];
  }

  /**
   * Run a red-team eval — tests agent resilience against adversarial inputs.
   * Generates attack prompts and scores the agent's refusals/responses.
   */
  async redTeam(params: {
    attackTypes?: Array<'jailbreak' | 'prompt-injection' | 'data-exfil' | 'social-engineering'>;
    intensity?: 'light' | 'moderate' | 'aggressive';
  }): Promise<EvalResponse> {
    return this.client.sentinel.redTeam({
      agentId: this.agentId,
      attackTypes: params.attackTypes ?? ['jailbreak', 'prompt-injection'],
      intensity: params.intensity ?? 'moderate',
    }) as Promise<EvalResponse>;
  }
}

export type { EvalResponse, ScoreResponse };

import { ArmaloClient } from '@armalo/core/client';
import type { JuryVerdict, JuryResponse } from '@armalo/core';

export interface JuryConfig {
  apiKey: string;
  agentId: string;
  baseUrl?: string;
}

export interface JurySubmission {
  pactId?: string;
  input: string;
  output: string;
  criteria?: string[];
  metadata?: Record<string, unknown>;
}

export interface JuryResult {
  judgmentId: string;
  verdict: 'pass' | 'fail' | 'pending';
  verdicts: JuryVerdict[];
  passed: boolean;
  failedCriteria: string[];
  confidence: number;
  rawResponse: JuryResponse;
}

/**
 * JuryClient — submits agent outputs for jury-backed verification.
 *
 * The Armalo jury is a pool of specialized LLM judges that evaluate whether
 * an agent's output satisfies the behavioral criteria in its pact. Jury
 * verdicts feed directly into trust scoring and certification.
 *
 * When to use jury verification:
 * - For high-stakes outputs (financial, medical, legal domains)
 * - When deterministic checks are insufficient
 * - For multi-party trust requirements (e.g., the customer needs proof)
 * - Before releasing escrow on a deal
 *
 * @example
 * ```typescript
 * import { JuryClient } from 'armalo-agent/jury';
 *
 * const jury = new JuryClient({ apiKey, agentId: 'my-agent' });
 *
 * const result = await jury.verify({
 *   input: 'Summarize the privacy policy',
 *   output: agentResponse,
 *   criteria: ['accurate', 'no_pii_in_summary', 'cites_source'],
 * });
 *
 * if (!result.passed) {
 *   console.warn('Failed criteria:', result.failedCriteria);
 * }
 * ```
 */
export class JuryClient {
  private client: ArmaloClient;
  readonly agentId: string;

  constructor(config: JuryConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  /**
   * Submit an agent output for jury review.
   *
   * Returns immediately with a judgment ID. The jury runs asynchronously —
   * use `poll()` or `waitForVerdict()` to retrieve results.
   */
  async submit(submission: JurySubmission): Promise<string> {
    const response = await this.client.jury.submit({
      agentId: this.agentId,
      pactId: submission.pactId,
      input: submission.input,
      output: submission.output,
      criteria: submission.criteria,
      metadata: submission.metadata,
    });
    return response.id;
  }

  /** Retrieve a jury verdict by ID. Returns null if still pending. */
  async poll(judgmentId: string): Promise<JuryResult | null> {
    const response = await this.client.jury.getJudgment(judgmentId);
    if (response.status !== 'complete') return null;
    return this.parseJuryResponse(judgmentId, response);
  }

  /**
   * Submit and wait for jury verdict — blocks until judges complete.
   *
   * @param submission - The input/output pair to evaluate
   * @param timeoutMs - Max ms to wait (default: 60s)
   * @param pollIntervalMs - How often to check (default: 2s)
   */
  async verify(
    submission: JurySubmission,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<JuryResult> {
    const judgmentId = await this.submit(submission);
    return this.waitForVerdict(judgmentId, opts);
  }

  /**
   * Wait for an existing jury judgment to complete.
   */
  async waitForVerdict(
    judgmentId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<JuryResult> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.poll(judgmentId);
      if (result) return result;
      await sleep(pollIntervalMs);
    }

    throw new Error(`Jury verdict for ${judgmentId} not received within ${timeoutMs}ms`);
  }

  /**
   * Batch-verify multiple outputs in parallel.
   * Useful for running a verification suite on a batch of agent responses.
   */
  async batchVerify(
    submissions: JurySubmission[],
    opts: { timeoutMs?: number } = {},
  ): Promise<JuryResult[]> {
    return Promise.all(submissions.map((s) => this.verify(s, opts)));
  }

  private parseJuryResponse(judgmentId: string, response: JuryResponse): JuryResult {
    const verdicts = response.verdicts ?? [];
    // Derive pass/fail from aggregatedScore (>= 60% of maxScore = pass) and consensus
    const passed = response.consensus === true
      || (response.aggregatedScore !== null && response.aggregatedScore !== undefined
          ? response.aggregatedScore >= 0.6
          : false);
    const overallVerdict: JuryResult['verdict'] =
      response.status === 'complete' ? (passed ? 'pass' : 'fail') : 'pending';
    // A juror "failed" a criterion when its score is below 60% of maxScore
    const failedCriteria = verdicts
      .filter((v) => v.score < v.maxScore * 0.6)
      .map((v) => v.criterion);
    const confidence =
      verdicts.length > 0
        ? verdicts.reduce((sum, v) => sum + (v.confidence ?? 0.5), 0) / verdicts.length
        : 0.5;

    return {
      judgmentId,
      verdict: overallVerdict,
      verdicts,
      passed,
      failedCriteria,
      confidence,
      rawResponse: response,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { JuryVerdict, JuryResponse };

import { ArmaloClient } from '@armalo/core/client';
import type { SieInvokeOptions } from '@armalo/core';

export interface SIEConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SIEPlan {
  goal: string;
  steps: Array<{
    title: string;
    description: string;
    estimatedMs?: number;
    requiredCapabilities?: string[];
  }>;
  estimatedTotalMs?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  autonomyTier?: string;
}

export interface SIEResult {
  goalId?: string;
  status: 'completed' | 'partial' | 'failed' | 'planned';
  outcome?: string;
  steps?: Array<{ step: string; result: string; success: boolean }>;
  creditsUsed?: number;
  durationMs?: number;
  rawResponse: Record<string, unknown>;
}

export interface CompoundLoopResult {
  cycles: number;
  improvements: string[];
  scoreGain?: number;
  stopped: string;
}

/**
 * SIEClient — Armalo Super Intelligence Engine for long-horizon agent autonomy.
 *
 * The SIE accepts natural-language goals and autonomously plans, executes,
 * and verifies complex multi-step operations. It runs inside Armalo's
 * governed execution environment with rate limiting, spend caps, and
 * safety constraints.
 *
 * Autonomy tiers:
 * - **observe** — reads and analyzes; takes no action
 * - **propose** — generates a plan but requires confirmation before executing
 * - **bounded** — executes within explicit constraints you provide
 * - **execute** — full autonomous execution (use with caution)
 *
 * @example
 * ```typescript
 * import { SIEClient } from 'armalo-agent/sie';
 *
 * const sie = new SIEClient({ apiKey: process.env.ARMALO_API_KEY! });
 *
 * // Generate a plan without executing
 * const plan = await sie.plan('Improve my agent accuracy to 0.95 within 2 weeks');
 * console.log(plan.steps);
 *
 * // Execute autonomously with a $10 spend cap
 * const result = await sie.invoke('Research top 3 competitors and summarize', {
 *   autonomyTier: 'execute',
 *   maxCredits: 10,
 *   timeboxMs: 60_000,
 * });
 * ```
 */
export class SIEClient {
  private client: ArmaloClient;

  constructor(config: SIEConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }

  /**
   * Get a structured execution plan without running it.
   * Always starts here — review and confirm before invoking.
   */
  async plan(goal: string, opts?: Omit<SieInvokeOptions, 'planOnly'>): Promise<SIEPlan> {
    const result = await this.client.sie.plan(goal, opts);
    return this.parsePlan(goal, result as Record<string, unknown>);
  }

  /**
   * Invoke the SIE to autonomously accomplish a goal.
   * Returns after the SIE has completed its execution (or hit a limit).
   */
  async invoke(goal: string, opts?: SieInvokeOptions): Promise<SIEResult> {
    const result = await this.client.sie.invoke(goal, opts);
    return this.parseResult(result as Record<string, unknown>);
  }

  /**
   * Run the compound RSI loop — the SIE continuously improves the agent
   * until the constraint or spend limit is reached.
   *
   * This is how agents transcend their initial capabilities. Each cycle:
   * 1. Identifies weakest trust dimensions
   * 2. Generates targeted improvement prompts
   * 3. Runs evals to validate improvements
   * 4. Updates internal weights and pact conditions
   */
  async runCompoundLoop(opts?: {
    autonomyTier?: SieInvokeOptions['autonomyTier'];
    maxCredits?: number;
    constraints?: string[];
    timeboxMs?: number;
  }): Promise<CompoundLoopResult> {
    const result = await this.client.sie.runCompoundLoop({
      autonomyTier: opts?.autonomyTier ?? 'propose',
      maxCredits: opts?.maxCredits,
      constraints: opts?.constraints,
      timeboxMs: opts?.timeboxMs,
    });

    const raw = result as Record<string, unknown>;
    return {
      cycles: typeof raw['cycles'] === 'number' ? raw['cycles'] : 0,
      improvements: (raw['improvements'] as string[]) ?? [],
      scoreGain: typeof raw['scoreGain'] === 'number' ? raw['scoreGain'] : undefined,
      stopped: String(raw['stopped'] ?? 'limit_reached'),
    };
  }

  /**
   * Check if the SIE endpoint is available and healthy.
   */
  async ping(): Promise<{ available: boolean; version?: string }> {
    try {
      const result = await this.client.sie.getHealth();
      const raw = result as Record<string, unknown>;
      return { available: true, version: String(raw['version'] ?? '') };
    } catch {
      return { available: false };
    }
  }

  /**
   * Execute a sequence of goals in order — each goal uses the output of the
   * previous as context.
   */
  async pipeline(
    goals: string[],
    opts?: SieInvokeOptions,
  ): Promise<SIEResult[]> {
    const results: SIEResult[] = [];
    let context = '';

    for (const goal of goals) {
      const enrichedGoal = context ? `${goal}\n\nContext from previous step:\n${context}` : goal;
      const result = await this.invoke(enrichedGoal, opts);
      results.push(result);
      if (result.outcome) context = result.outcome;
    }

    return results;
  }

  private parsePlan(goal: string, raw: Record<string, unknown>): SIEPlan {
    const rawSteps = (raw['steps'] as Array<Record<string, unknown>>) ?? [];
    return {
      goal,
      steps: rawSteps.map((s) => ({
        title: String(s['title'] ?? s['name'] ?? ''),
        description: String(s['description'] ?? ''),
        estimatedMs: typeof s['estimatedMs'] === 'number' ? s['estimatedMs'] : undefined,
        requiredCapabilities: (s['requiredCapabilities'] as string[]) ?? [],
      })),
      estimatedTotalMs: typeof raw['estimatedTotalMs'] === 'number' ? raw['estimatedTotalMs'] : undefined,
      riskLevel: raw['riskLevel'] as SIEPlan['riskLevel'],
      autonomyTier: String(raw['autonomyTier'] ?? 'propose'),
    };
  }

  private parseResult(raw: Record<string, unknown>): SIEResult {
    return {
      goalId: typeof raw['goalId'] === 'string' ? raw['goalId'] : undefined,
      status: (raw['status'] as SIEResult['status']) ?? 'completed',
      outcome: typeof raw['outcome'] === 'string' ? raw['outcome'] : undefined,
      steps: raw['steps'] as SIEResult['steps'],
      creditsUsed: typeof raw['creditsUsed'] === 'number' ? raw['creditsUsed'] : undefined,
      durationMs: typeof raw['durationMs'] === 'number' ? raw['durationMs'] : undefined,
      rawResponse: raw,
    };
  }
}

export type { SieInvokeOptions };

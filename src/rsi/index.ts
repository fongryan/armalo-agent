import { ArmaloClient } from '@armalo/core/client';
import type { ScoreResponse } from '@armalo/core';

export interface RSIConfig {
  apiKey: string;
  agentId: string;
  baseUrl?: string;
}

export interface RSILoopOptions {
  maxCycles?: number;
  minScoreGain?: number;
  dryRun?: boolean;
  onCycleStart?: (cycle: number, score: ScoreResponse | null) => void;
  onCycleEnd?: (cycle: number, result: RSICycleResult) => void;
}

export interface RSIImprovement {
  dimension: string;
  currentValue: number;
  targetValue: number;
  action: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RSICycleResult {
  cycle: number;
  scoreBefore: number;
  scoreAfter: number;
  gain: number;
  improvements: RSIImprovement[];
  flywheelId?: string;
  status: 'improved' | 'no_gain' | 'error';
}

/**
 * RSIEngine — Recursive Self-Improvement flywheel for autonomous agents.
 *
 * Implements the SCAN → RANK → ACT → VERIFY → LEARN → ADAPT loop:
 *
 * 1. **SCAN** — Read current trust score and skill insights
 * 2. **RANK** — Identify dimensions with lowest scores (biggest improvement potential)
 * 3. **ACT** — Trigger Armalo's RSI flywheel for targeted improvements
 * 4. **VERIFY** — Run evals to confirm improvements landed
 * 5. **LEARN** — Persist improvement patterns to Cortex memory
 * 6. **ADAPT** — Adjust strategy based on what worked
 *
 * After each cycle, the agent's behavioral pacts are evaluated and weak
 * dimensions are automatically targeted for reinforcement.
 *
 * @example
 * ```typescript
 * import { RSIEngine } from 'armalo-agent/rsi';
 *
 * const rsi = new RSIEngine({ apiKey, agentId: 'my-agent' });
 *
 * // Run 5 improvement cycles, stop when <2 point gain per cycle
 * await rsi.runLoop({
 *   maxCycles: 5,
 *   minScoreGain: 2,
 *   onCycleEnd: (cycle, result) => {
 *     console.log(`Cycle ${cycle}: +${result.gain} points → ${result.scoreAfter}/1000`);
 *   },
 * });
 * ```
 */
export class RSIEngine {
  private client: ArmaloClient;
  readonly agentId: string;

  constructor(config: RSIConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  /**
   * Run a single RSI cycle: SCAN → RANK → ACT → VERIFY → LEARN.
   */
  async runCycle(cycle: number): Promise<RSICycleResult> {
    // SCAN
    const [currentScore, insights] = await Promise.all([
      this.client.getScore(this.agentId).catch(() => null),
      this.client.rsi.getSkillInsights(this.agentId).catch(() => ({})),
    ]);

    const scoreBefore = (currentScore as ScoreResponse | null)?.compositeScore ?? 0;

    // RANK — identify worst-performing dimensions
    const improvements = this.rankImprovements(currentScore, insights);

    if (improvements.length === 0) {
      return { cycle, scoreBefore, scoreAfter: scoreBefore, gain: 0, improvements: [], status: 'no_gain' };
    }

    // ACT — trigger the flywheel for the highest-priority improvements
    const highPriority = improvements.filter((i) => i.priority === 'high');
    let flywheelId: string | undefined;
    try {
      const flywheels = await this.client.rsi.listFlywheels();
      const flywheel = (flywheels as Record<string, Array<Record<string, string>>>)['flywheels']?.[0];
      if (flywheel?.['id']) {
        const result = await this.client.rsi.triggerFlywheel(
          flywheel['id'],
          `RSI cycle ${cycle}: targeting ${highPriority.map((i) => i.dimension).join(', ')}`,
        );
        flywheelId = (result as Record<string, string>)['id'];
      }
    } catch {
      // Flywheel trigger is best-effort
    }

    // Wait for the flywheel to run
    await sleep(5_000);

    // VERIFY — check if score improved
    const newScore = await this.client.getScore(this.agentId).catch(() => currentScore);
    const scoreAfter = (newScore as ScoreResponse | null)?.compositeScore ?? scoreBefore;
    const gain = scoreAfter - scoreBefore;

    // LEARN — persist learnings to Cortex
    await this.learnFromCycle(cycle, improvements, gain);

    return {
      cycle,
      scoreBefore,
      scoreAfter,
      gain,
      improvements,
      flywheelId,
      status: gain > 0 ? 'improved' : 'no_gain',
    };
  }

  /**
   * Run the full RSI loop autonomously.
   * Stops when maxCycles is reached or gain per cycle drops below minScoreGain.
   */
  async runLoop(opts: RSILoopOptions = {}): Promise<RSICycleResult[]> {
    const maxCycles = opts.maxCycles ?? 10;
    const minScoreGain = opts.minScoreGain ?? 1;
    const results: RSICycleResult[] = [];

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      const currentScore = await this.client.getScore(this.agentId).catch(() => null);
      opts.onCycleStart?.(cycle, currentScore as ScoreResponse);

      const result = await this.runCycle(cycle);
      results.push(result);

      opts.onCycleEnd?.(cycle, result);

      if (result.status === 'error') break;
      if (result.gain < minScoreGain && cycle > 1) {
        console.log(`[RSI] Gain ${result.gain} < threshold ${minScoreGain} — stopping loop`);
        break;
      }
    }

    return results;
  }

  /** Get the current RSI state for this agent. */
  async getState(): Promise<Record<string, unknown>> {
    return this.client.rsi.getAgentState(this.agentId) as Promise<Record<string, unknown>>;
  }

  /** Configure RSI parameters (exploration rate, improvement targets, etc.). */
  async configure(params: {
    targetDimensions?: string[];
    explorationRate?: number;
    minEvalFrequency?: number;
    autonomyTier?: 'observe' | 'propose' | 'bounded' | 'execute';
  }): Promise<void> {
    await this.client.rsi.configure(this.agentId, params);
  }

  /** Get a history of past RSI cycles and their outcomes. */
  async getHistory(opts?: { limit?: number }): Promise<Record<string, unknown>[]> {
    const result = await this.client.rsi.listHistory(this.agentId, opts) as Record<string, unknown>;
    return (result['entries'] as Record<string, unknown>[]) ?? [];
  }

  private rankImprovements(
    score: ScoreResponse | null,
    _insights: unknown,
  ): RSIImprovement[] {
    if (!score) return [];
    const dimensions = (score as unknown as Record<string, Record<string, number>>)['dimensions'] ?? {};
    return Object.entries(dimensions)
      .map(([dim, value]) => ({
        dimension: dim,
        currentValue: value,
        targetValue: Math.min(1.0, value + 0.1),
        action: `improve_${dim}`,
        priority: value < 0.6 ? 'high' : value < 0.8 ? 'medium' : 'low' as RSIImprovement['priority'],
      }))
      .filter((i) => i.currentValue < 0.95)
      .sort((a, b) => a.currentValue - b.currentValue)
      .slice(0, 3);
  }

  private async learnFromCycle(
    cycle: number,
    improvements: RSIImprovement[],
    gain: number,
  ): Promise<void> {
    try {
      await this.client.cortex.remember({
        agentId: this.agentId,
        key: `rsi_cycle_${cycle}`,
        value: JSON.stringify({
          cycle,
          targetedDimensions: improvements.map((i) => i.dimension),
          gain,
          timestamp: new Date().toISOString(),
        }),
        importance: gain > 5 ? 0.9 : 0.5,
      });
    } catch {
      // Cortex writes are best-effort
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BenchmarkCase {
  name: string;
  input: string;
  expectedLatencyMs?: number;
  expectedMinTokens?: number;
  expectedMaxTokens?: number;
}

export interface BenchmarkRun {
  case: BenchmarkCase;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  success: boolean;
  output?: string;
  error?: string;
}

export interface BenchmarkSummary {
  totalRuns: number;
  successRate: number;
  latency: { p50: number; p75: number; p95: number; mean: number; max: number };
  tokens: { inputMean: number; outputMean: number; totalMean: number };
  throughput: { runsPerMinute: number };
  costEstimate: { usdPerRun: number; usdFor1000Runs: number };
  failureReasons: string[];
  runs: BenchmarkRun[];
}

/** Cost per 1M tokens — used only for rough estimation; check Anthropic's pricing for exact figures. */
const COST_PER_1M_INPUT_TOKENS = 3.0;
const COST_PER_1M_OUTPUT_TOKENS = 15.0;

/**
 * BenchmarkRunner — measures latency, accuracy, and cost for your agent.
 *
 * Run benchmarks during development to:
 * - Establish performance baselines before evals
 * - Detect regressions when changing models or prompts
 * - Estimate operational cost per query
 * - Identify tail latency issues (p95 / p99)
 *
 * @example
 * ```typescript
 * import { BenchmarkRunner } from 'armalo-agent/eval';
 *
 * const bench = new BenchmarkRunner();
 * const summary = await bench.run(cases, async (input) => {
 *   const r = await agent.run(input);
 *   return { output: r.output, inputTokens: r.session.totalInputTokens, outputTokens: r.session.totalOutputTokens };
 * });
 * bench.printSummary(summary);
 * ```
 */
export class BenchmarkRunner {
  private warmupRuns: number;
  private repetitions: number;
  private concurrency: number;

  constructor(opts: { warmupRuns?: number; repetitions?: number; concurrency?: number } = {}) {
    this.warmupRuns = opts.warmupRuns ?? 1;
    this.repetitions = opts.repetitions ?? 3;
    this.concurrency = opts.concurrency ?? 1;
  }

  /**
   * Run the benchmark suite.
   *
   * The `runFn` should return the output text plus token counts — get these
   * from your `RunResult.session` after calling `agent.run()`.
   */
  async run(
    cases: BenchmarkCase[],
    runFn: (input: string) => Promise<{ output: string; inputTokens?: number; outputTokens?: number }>,
  ): Promise<BenchmarkSummary> {
    // Warmup
    for (let i = 0; i < this.warmupRuns && cases.length > 0; i++) {
      try { await runFn(cases[0]!.input); } catch { /* ignore warmup errors */ }
    }

    const allRuns: BenchmarkRun[] = [];
    const startTime = Date.now();

    // Run cases with optional concurrency
    const chunks = chunkArray(
      cases.flatMap((c) => Array.from({ length: this.repetitions }, () => c)),
      this.concurrency,
    );

    for (const chunk of chunks) {
      const chunkRuns = await Promise.all(
        chunk.map(async (c): Promise<BenchmarkRun> => {
          const t0 = Date.now();
          try {
            const result = await runFn(c.input);
            const latencyMs = Date.now() - t0;
            const inputTokens = result.inputTokens ?? 0;
            const outputTokens = result.outputTokens ?? 0;
            return {
              case: c,
              latencyMs,
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              success: true,
              output: result.output,
            };
          } catch (err) {
            return {
              case: c,
              latencyMs: Date.now() - t0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      allRuns.push(...chunkRuns);
    }

    const totalElapsedMs = Date.now() - startTime;
    return this.summarize(allRuns, totalElapsedMs);
  }

  /** Compare two benchmark summaries — useful for regression testing. */
  compare(
    baseline: BenchmarkSummary,
    candidate: BenchmarkSummary,
  ): { latencyDeltaPercent: number; costDeltaPercent: number; successRateDelta: number; improved: boolean } {
    const latencyDelta = ((candidate.latency.p50 - baseline.latency.p50) / baseline.latency.p50) * 100;
    const costDelta = ((candidate.costEstimate.usdPerRun - baseline.costEstimate.usdPerRun) / baseline.costEstimate.usdPerRun) * 100;
    const successDelta = candidate.successRate - baseline.successRate;
    return {
      latencyDeltaPercent: latencyDelta,
      costDeltaPercent: costDelta,
      successRateDelta: successDelta,
      improved: latencyDelta < 0 && costDelta <= 0 && successDelta >= 0,
    };
  }

  /** Print a formatted summary table to stdout. */
  printSummary(summary: BenchmarkSummary): void {
    const { latency, tokens, throughput, costEstimate } = summary;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  BENCHMARK SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Runs        : ${summary.totalRuns} (${(summary.successRate * 100).toFixed(1)}% success)`);
    console.log(`  Latency     : p50=${latency.p50}ms  p95=${latency.p95}ms  mean=${latency.mean}ms`);
    console.log(`  Tokens/run  : ${tokens.totalMean.toFixed(0)} total (${tokens.inputMean.toFixed(0)} in / ${tokens.outputMean.toFixed(0)} out)`);
    console.log(`  Throughput  : ${throughput.runsPerMinute.toFixed(1)} runs/min`);
    console.log(`  Est. cost   : $${costEstimate.usdPerRun.toFixed(4)}/run  →  $${costEstimate.usdFor1000Runs.toFixed(2)}/1000 runs`);
    if (summary.failureReasons.length > 0) {
      console.log(`  Failures    : ${summary.failureReasons.join(', ')}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  private summarize(runs: BenchmarkRun[], totalElapsedMs: number): BenchmarkSummary {
    const successful = runs.filter((r) => r.success);
    const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b);

    const inputTokenMean = avg(successful.map((r) => r.inputTokens));
    const outputTokenMean = avg(successful.map((r) => r.outputTokens));
    const costPerRun =
      (inputTokenMean / 1_000_000) * COST_PER_1M_INPUT_TOKENS +
      (outputTokenMean / 1_000_000) * COST_PER_1M_OUTPUT_TOKENS;

    return {
      totalRuns: runs.length,
      successRate: runs.length > 0 ? successful.length / runs.length : 0,
      latency: {
        p50: percentile(latencies, 50),
        p75: percentile(latencies, 75),
        p95: percentile(latencies, 95),
        mean: Math.round(avg(latencies)),
        max: latencies[latencies.length - 1] ?? 0,
      },
      tokens: {
        inputMean: Math.round(inputTokenMean),
        outputMean: Math.round(outputTokenMean),
        totalMean: Math.round(inputTokenMean + outputTokenMean),
      },
      throughput: {
        runsPerMinute: runs.length > 0 ? (runs.length / totalElapsedMs) * 60_000 : 0,
      },
      costEstimate: {
        usdPerRun: costPerRun,
        usdFor1000Runs: costPerRun * 1000,
      },
      failureReasons: runs
        .filter((r) => !r.success)
        .map((r) => r.error ?? 'unknown')
        .slice(0, 5),
      runs,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx] ?? 0;
}

function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

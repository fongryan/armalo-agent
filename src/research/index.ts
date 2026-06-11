/**
 * AutonomousResearcher — a self-directing multi-session research agent.
 *
 * Research questions survive session restarts via Cortex memory. On each run
 * the researcher loads its pending queue, picks the highest-priority question,
 * plans the research via SIE, executes using TrustNativeAgent (web search +
 * URL fetch), synthesizes findings, stores results in Cortex, and optionally
 * publishes deliverables to the Armalo marketplace.
 *
 * Sessions are additive: each run builds on prior findings rather than
 * starting over. Cross-session continuity is automatic.
 *
 * @example
 * ```typescript
 * import { AutonomousResearcher } from 'armalo-agent/research';
 *
 * const researcher = new AutonomousResearcher({
 *   apiKey: process.env.ARMALO_API_KEY!,
 *   agentId: 'my-researcher',
 *   publishToMarketplace: true,
 * });
 *
 * // Add research questions (persisted to Cortex)
 * await researcher.addQuestion('What are the most effective AI safety techniques in 2025?', { priority: 'high' });
 * await researcher.addQuestion('Compare the top 5 vector databases by cost and latency', { priority: 'medium' });
 *
 * // Run: automatically picks the highest-priority pending question
 * const session = await researcher.resumeOrStart();
 * console.log(session.question, session.findings.summary);
 * ```
 */

import { ArmaloClient } from '@armalo/core/client';
import { TrustNativeAgent } from '../agent.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResearcherConfig {
  apiKey: string;
  agentId: string;
  anthropicApiKey?: string;
  /** Automatically publish completed research to the Armalo marketplace. Default: false */
  publishToMarketplace?: boolean;
  /** Price in USDC to sell research deliverables. Default: 10 */
  marketplacePriceUsdc?: number;
  /** Max iterations per research session. Default: 5 */
  maxIterations?: number;
  baseUrl?: string;
}

export type ResearchPriority = 'critical' | 'high' | 'medium' | 'low';
export type ResearchStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

export interface ResearchQuestion {
  id: string;
  question: string;
  priority: ResearchPriority;
  status: ResearchStatus;
  tags?: string[];
  addedAt: string;
  updatedAt?: string;
  /** Cortex key where the findings are stored */
  findingsKey?: string;
}

export interface ResearchFindings {
  questionId: string;
  question: string;
  summary: string;
  details: string;
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
  completedAt: string;
  iterations: number;
  tokensUsed: number;
  listingId?: string;
}

export interface ResearchSession {
  question: ResearchQuestion;
  findings: ResearchFindings;
  sessionStartedAt: string;
  sessionEndedAt: string;
  published: boolean;
}

export interface ResearchQueue {
  pending: ResearchQuestion[];
  inProgress: ResearchQuestion[];
  completed: ResearchQuestion[];
  failed: ResearchQuestion[];
  total: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class AutonomousResearcher {
  private client: ArmaloClient;
  private agent: TrustNativeAgent | null = null;
  readonly config: Required<ResearcherConfig>;

  private static readonly QUEUE_KEY = 'researcher_question_queue';
  private static readonly FINDINGS_PREFIX = 'researcher_findings_';

  constructor(config: ResearcherConfig) {
    this.config = {
      publishToMarketplace: false,
      marketplacePriceUsdc: 10,
      maxIterations: 5,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      baseUrl: undefined as unknown as string,
      ...config,
    };

    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });

    if (this.config.anthropicApiKey) {
      this.agent = new TrustNativeAgent({
        armaloApiKey: config.apiKey,
        agentId: config.agentId,
        anthropicApiKey: this.config.anthropicApiKey,
        showTrustScore: false,
        systemPrompt: this.buildResearcherPrompt(),
      });
    }
  }

  /**
   * Add a research question to the persistent queue.
   *
   * Questions survive session restarts — call this once, then let
   * `resumeOrStart()` pick it up on any future run.
   */
  async addQuestion(
    question: string,
    opts: { priority?: ResearchPriority; tags?: string[] } = {},
  ): Promise<ResearchQuestion> {
    const queue = await this.loadQueue();
    const id = `rq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const newQ: ResearchQuestion = {
      id,
      question,
      priority: opts.priority ?? 'medium',
      status: 'pending',
      tags: opts.tags,
      addedAt: new Date().toISOString(),
    };

    queue.pending.push(newQ);
    await this.saveQueue(queue);
    return newQ;
  }

  /**
   * Get the current state of the research queue across all sessions.
   */
  async getQueue(): Promise<ResearchQueue> {
    return this.loadQueue();
  }

  /**
   * Resume the highest-priority pending question, or start fresh if the queue
   * has in-progress questions from a previous session.
   *
   * Returns null if there are no pending or in-progress questions.
   */
  async resumeOrStart(): Promise<ResearchSession | null> {
    const queue = await this.loadQueue();

    // Prefer resuming in-progress (previous session was interrupted)
    let targetId: string | null = queue.inProgress[0]?.id ?? null;

    // Otherwise pick highest-priority pending
    if (!targetId) {
      const priorityOrder: ResearchPriority[] = ['critical', 'high', 'medium', 'low'];
      for (const priority of priorityOrder) {
        const found = queue.pending.find((q) => q.priority === priority);
        if (found) { targetId = found.id; break; }
      }
    }

    if (!targetId) return null;

    return this.research(targetId);
  }

  /**
   * Execute research on a specific question by ID.
   *
   * Plans the research (via SIE if available, otherwise directly), runs
   * multiple research iterations, synthesizes findings, and persists to Cortex.
   */
  async research(questionId: string): Promise<ResearchSession> {
    const queue = await this.loadQueue();
    const question = this.findQuestion(queue, questionId);

    if (!question) throw new Error(`Question ${questionId} not found`);

    // Mark as in-progress
    question.status = 'in_progress';
    question.updatedAt = new Date().toISOString();
    await this.saveQueue(queue);

    const sessionStart = new Date().toISOString();
    let totalTokens = 0;
    let totalIterations = 0;

    // Check for prior partial findings (resume from previous session)
    const priorFindings = await this.loadFindings(questionId);

    // Execute research iterations
    const iterations: string[] = [];
    if (priorFindings) {
      iterations.push(`Prior research summary: ${priorFindings.summary}`);
    }

    if (!this.agent) {
      // No Anthropic key — return a placeholder but mark as failed
      question.status = 'failed';
      question.updatedAt = new Date().toISOString();
      await this.saveQueue(queue);
      throw new Error('ANTHROPIC_API_KEY required to execute research');
    }

    for (let i = 0; i < this.config.maxIterations; i++) {
      const iterationPrompt = this.buildIterationPrompt(question.question, iterations, i);

      try {
        const result = await this.agent.run(iterationPrompt);
        iterations.push(result.output);
        totalTokens += result.session.totalInputTokens + result.session.totalOutputTokens;
        totalIterations += result.session.iterations;

        // Stop early if the iteration produced a conclusion
        if (result.output.toLowerCase().includes('[research complete]') ||
            result.output.toLowerCase().includes('in conclusion') ||
            (i >= 2 && result.output.length > 500)) {
          break;
        }
      } catch {
        break;
      }
    }

    // Synthesize all iterations into final findings
    const synthesis = await this.synthesize(question.question, iterations);
    totalTokens += synthesis.tokens;

    const findings: ResearchFindings = {
      questionId,
      question: question.question,
      summary: synthesis.summary,
      details: synthesis.details,
      sources: synthesis.sources,
      confidence: synthesis.confidence,
      completedAt: new Date().toISOString(),
      iterations: totalIterations,
      tokensUsed: totalTokens,
    };

    // Persist findings to Cortex
    await this.saveFindings(questionId, findings);

    // Optionally publish to marketplace
    let listingId: string | undefined;
    let published = false;
    if (this.config.publishToMarketplace) {
      listingId = await this.publishFindings(findings).catch(() => undefined);
      if (listingId) {
        findings.listingId = listingId;
        published = true;
        await this.saveFindings(questionId, findings);
      }
    }

    // Update question status
    question.status = 'complete';
    question.findingsKey = `${AutonomousResearcher.FINDINGS_PREFIX}${questionId}`;
    question.updatedAt = new Date().toISOString();

    // Move to completed queue
    this.moveQuestion(queue, questionId, 'completed');
    await this.saveQueue(queue);

    return {
      question,
      findings,
      sessionStartedAt: sessionStart,
      sessionEndedAt: new Date().toISOString(),
      published,
    };
  }

  /**
   * Retrieve all completed research findings from Cortex.
   */
  async getAllFindings(): Promise<ResearchFindings[]> {
    const queue = await this.loadQueue();
    const results: ResearchFindings[] = [];

    for (const q of queue.completed) {
      const findings = await this.loadFindings(q.id);
      if (findings) results.push(findings);
    }

    return results;
  }

  /**
   * Retrieve findings for a specific question.
   */
  async getFindings(questionId: string): Promise<ResearchFindings | null> {
    return this.loadFindings(questionId);
  }

  /**
   * Run multiple research sessions back-to-back until the queue is empty.
   *
   * Useful for batch-processing a set of research questions overnight.
   */
  async runBatch(opts: { maxQuestions?: number } = {}): Promise<ResearchSession[]> {
    const sessions: ResearchSession[] = [];
    const max = opts.maxQuestions ?? Infinity;

    while (sessions.length < max) {
      const session = await this.resumeOrStart();
      if (!session) break;
      sessions.push(session);
    }

    return sessions;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildResearcherPrompt(): string {
    return `You are a rigorous research agent. Your job is to investigate questions thoroughly and produce accurate, well-sourced answers.

Guidelines:
- Use web search and URL fetch tools to find current, authoritative sources
- Cite every factual claim with a source URL
- Distinguish between facts, estimates, and opinions
- If you cannot verify a claim, say so explicitly — do not confabulate
- When you have enough information to synthesize a complete answer, end your response with [research complete]
- Be comprehensive but concise — aim for depth over length`;
  }

  private buildIterationPrompt(question: string, prior: string[], iteration: number): string {
    if (iteration === 0 && prior.length === 0) {
      return `Research question: ${question}\n\nSearch for the most relevant and authoritative information. Focus on facts, data, and expert consensus.`;
    }

    if (iteration === 0 && prior.length > 0) {
      return `Research question: ${question}\n\n${prior[0]}\n\nContinue researching. Look for more recent information, alternative perspectives, or data that contradicts or confirms what was found.`;
    }

    const lastIteration = prior[prior.length - 1] ?? '';
    return `Research question: ${question}\n\nSo far you have found:\n${lastIteration.slice(0, 800)}\n\nDig deeper into the most important aspects. Look for specific data points, expert quotes, or concrete examples. If you have enough to write a complete answer, do so now and end with [research complete].`;
  }

  private async synthesize(
    question: string,
    iterations: string[],
  ): Promise<{ summary: string; details: string; sources: string[]; confidence: 'high' | 'medium' | 'low'; tokens: number }> {
    if (!this.agent || iterations.length === 0) {
      return { summary: 'No research completed.', details: '', sources: [], confidence: 'low', tokens: 0 };
    }

    const combined = iterations.join('\n\n---\n\n').slice(0, 3000);
    const synthPrompt = `Based on the following research iterations, produce a synthesis.

Question: ${question}

Research gathered:
${combined}

Output format:
SUMMARY: (2-3 sentence executive summary)
DETAILS: (comprehensive answer with all important findings)
SOURCES: (comma-separated list of URLs mentioned)
CONFIDENCE: (high / medium / low — based on source quality and consistency)`;

    try {
      const result = await this.agent.run(synthPrompt);
      const text = result.output;

      const summary = extractSection(text, 'SUMMARY') ?? text.slice(0, 200);
      const details = extractSection(text, 'DETAILS') ?? text;
      const sourcesRaw = extractSection(text, 'SOURCES') ?? '';
      const sources = sourcesRaw.split(',').map((s) => s.trim()).filter((s) => s.startsWith('http'));
      const confidenceRaw = extractSection(text, 'CONFIDENCE')?.toLowerCase() ?? 'medium';
      const confidence: 'high' | 'medium' | 'low' = confidenceRaw.includes('high') ? 'high' : confidenceRaw.includes('low') ? 'low' : 'medium';

      return { summary, details, sources, confidence, tokens: result.session.totalInputTokens + result.session.totalOutputTokens };
    } catch {
      const fallback = iterations[iterations.length - 1] ?? '';
      return { summary: fallback.slice(0, 200), details: fallback, sources: [], confidence: 'low', tokens: 0 };
    }
  }

  private async publishFindings(findings: ResearchFindings): Promise<string | undefined> {
    try {
      const listing = await this.client.marketplace.createListing({
        agentId: this.config.agentId,
        title: `Research: ${findings.question.slice(0, 80)}`,
        description: findings.summary,
        priceUsdc: this.config.marketplacePriceUsdc,
        listingType: 'service',
        tags: ['research', 'analysis', 'report'],
      });
      return (listing as unknown as Record<string, string>)['id'];
    } catch {
      return undefined;
    }
  }

  private async loadQueue(): Promise<{
    pending: ResearchQuestion[];
    inProgress: ResearchQuestion[];
    completed: ResearchQuestion[];
    failed: ResearchQuestion[];
    total: number;
  }> {
    try {
      const memory = await this.client.cortex.recall({
        agentId: this.config.agentId,
        key: AutonomousResearcher.QUEUE_KEY,
        limit: 1,
      });
      const raw = (memory as unknown as Record<string, string>)['value'];
      if (!raw) return this.emptyQueue();
      return JSON.parse(raw) as ReturnType<typeof this.emptyQueue>;
    } catch {
      return this.emptyQueue();
    }
  }

  private async saveQueue(queue: ReturnType<typeof this.emptyQueue>): Promise<void> {
    queue.total = queue.pending.length + queue.inProgress.length + queue.completed.length + queue.failed.length;
    await this.client.cortex.remember({
      agentId: this.config.agentId,
      key: AutonomousResearcher.QUEUE_KEY,
      value: JSON.stringify(queue),
      importance: 0.9,
    });
  }

  private async loadFindings(questionId: string): Promise<ResearchFindings | null> {
    try {
      const memory = await this.client.cortex.recall({
        agentId: this.config.agentId,
        key: `${AutonomousResearcher.FINDINGS_PREFIX}${questionId}`,
        limit: 1,
      });
      const raw = (memory as unknown as Record<string, string>)['value'];
      if (!raw) return null;
      return JSON.parse(raw) as ResearchFindings;
    } catch {
      return null;
    }
  }

  private async saveFindings(questionId: string, findings: ResearchFindings): Promise<void> {
    await this.client.cortex.remember({
      agentId: this.config.agentId,
      key: `${AutonomousResearcher.FINDINGS_PREFIX}${questionId}`,
      value: JSON.stringify(findings),
      importance: 0.85,
    });
  }

  private emptyQueue() {
    return { pending: [] as ResearchQuestion[], inProgress: [] as ResearchQuestion[], completed: [] as ResearchQuestion[], failed: [] as ResearchQuestion[], total: 0 };
  }

  private findQuestion(queue: ReturnType<typeof this.emptyQueue>, id: string): ResearchQuestion | null {
    return (
      queue.pending.find((q) => q.id === id) ??
      queue.inProgress.find((q) => q.id === id) ??
      queue.completed.find((q) => q.id === id) ??
      queue.failed.find((q) => q.id === id) ??
      null
    );
  }

  private moveQuestion(queue: ReturnType<typeof this.emptyQueue>, id: string, to: 'completed' | 'failed'): void {
    for (const bucket of [queue.pending, queue.inProgress] as ResearchQuestion[][]) {
      const idx = bucket.findIndex((q) => q.id === id);
      if (idx !== -1) {
        const [q] = bucket.splice(idx, 1);
        if (q) queue[to].push(q);
        return;
      }
    }
  }
}

function extractSection(text: string, label: string): string | null {
  const pattern = new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's');
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

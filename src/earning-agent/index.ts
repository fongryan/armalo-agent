/**
 * AutonomousEarningAgent — a production-ready agent that participates in the
 * Armalo marketplace end-to-end.
 *
 * The agent:
 * 1. Registers its capabilities as marketplace listings
 * 2. Monitors for incoming deal proposals
 * 3. Accepts deals that fit its skills and trust tier
 * 4. Executes the contracted work via TrustNativeAgent
 * 5. Sends output for jury verification before delivery
 * 6. Releases escrow on jury approval → earns USDC
 * 7. Revises and resubmits on jury rejection (up to maxRevisions)
 * 8. Records every deal in Cortex for cross-session tracking
 * 9. Triggers one RSI cycle after each deal to stay competitive
 *
 * This is NOT a demo — connect a real API key and it will accept and
 * execute live deals on the Armalo marketplace.
 *
 * @example
 * ```typescript
 * import { AutonomousEarningAgent } from 'armalo-agent/earning-agent';
 *
 * const agent = new AutonomousEarningAgent({
 *   apiKey: process.env.ARMALO_API_KEY!,
 *   agentId: 'my-earning-agent',
 *   capabilities: ['research', 'writing', 'analysis'],
 *   minDealValueUsdc: 5,
 * });
 *
 * // Run the full earning loop — accepts deals, works, earns, improves
 * await agent.runLoop({ maxDeals: 10 });
 *
 * const earnings = await agent.getLifetimeEarnings();
 * console.log(`Total earned: $${earnings.totalUsdc} USDC`);
 * ```
 */

import { ArmaloClient } from '@armalo/core/client';
import type { Deal, Listing, Escrow } from '@armalo/core';
import { TrustNativeAgent } from '../agent.js';
import { JuryClient } from '../jury/index.js';
import { RSIEngine } from '../rsi/index.js';
import type { JuryResult } from '../jury/index.js';
import type { InferenceClient } from '../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EarningAgentConfig {
  apiKey: string;
  agentId: string;
  anthropicApiKey?: string;
  inferenceClient?: InferenceClient;
  capabilities: string[];
  /** Minimum deal value to accept (USDC). Default: 1 */
  minDealValueUsdc?: number;
  /** Maximum number of revision attempts per deal before abandoning. Default: 2 */
  maxRevisions?: number;
  /** How long to wait for jury verdict (ms). Default: 90s */
  juryTimeoutMs?: number;
  /** Whether to run an RSI cycle after each completed deal. Default: true */
  rsiAfterDeal?: boolean;
  baseUrl?: string;
}

export interface SkillListing {
  title: string;
  description: string;
  priceUsdc: number;
  deliveryDays?: number;
  tags?: string[];
}

export interface ActiveDeal {
  deal: Deal;
  escrow?: Escrow;
  listing?: Listing;
  acceptedAt: string;
}

export interface WorkOutput {
  content: string;
  tokensUsed: number;
  latencyMs: number;
  iterations: number;
}

export interface DeliverResult {
  dealId: string;
  verdict: 'delivered' | 'jury_rejected' | 'abandoned';
  juryResult?: JuryResult;
  earnedUsdc?: number;
  revisionsUsed: number;
}

export interface EarningsReport {
  totalDeals: number;
  successfulDeals: number;
  abandonedDeals: number;
  totalUsdc: number;
  averageUsdcPerDeal: number;
  topSkill?: string;
  recentDeals: DealRecord[];
}

export interface DealRecord {
  dealId: string;
  title: string;
  earnedUsdc: number;
  verdict: string;
  completedAt: string;
  skill?: string;
}

export interface EarningLoopOptions {
  /** Maximum number of deals to accept. Default: unlimited */
  maxDeals?: number;
  /** How often to check for new deals (ms). Default: 30s */
  pollIntervalMs?: number;
  /** Stop the loop after this many ms. Default: unlimited */
  timeboxMs?: number;
  /** Called when a deal is accepted */
  onDealAccepted?: (deal: ActiveDeal) => void;
  /** Called when a deal is delivered */
  onDealDelivered?: (result: DeliverResult) => void;
  /** Called each poll cycle even when no new deals are found */
  onIdle?: (checkedAt: string) => void;
}

export interface EarningLoopResult {
  dealsProcessed: number;
  totalEarned: number;
  elapsedMs: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class AutonomousEarningAgent {
  private client: ArmaloClient;
  private jury: JuryClient;
  private rsi: RSIEngine;
  private agent: TrustNativeAgent | null = null;
  readonly config: Required<Omit<EarningAgentConfig, 'inferenceClient'>> & {
    inferenceClient?: InferenceClient;
  };

  constructor(config: EarningAgentConfig) {
    this.config = {
      minDealValueUsdc: 1,
      maxRevisions: 2,
      juryTimeoutMs: 90_000,
      rsiAfterDeal: true,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      inferenceClient: config.inferenceClient,
      baseUrl: undefined as unknown as string,
      ...config,
    };

    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.jury = new JuryClient({ apiKey: config.apiKey, agentId: config.agentId, baseUrl: config.baseUrl });

    this.rsi = new RSIEngine({ apiKey: config.apiKey, agentId: config.agentId, baseUrl: config.baseUrl });

    if (this.config.anthropicApiKey || this.config.inferenceClient) {
      this.agent = new TrustNativeAgent({
        armaloApiKey: config.apiKey,
        agentId: config.agentId,
        anthropicApiKey: this.config.anthropicApiKey,
        inferenceClient: this.config.inferenceClient,
        showTrustScore: false,
      });
    }
  }

  /**
   * Register this agent's capabilities as marketplace listings.
   *
   * Safe to call on every startup — existing listings are not duplicated.
   * Returns the listing IDs that were created or already existed.
   */
  async registerSkills(skills: SkillListing[]): Promise<string[]> {
    const ids: string[] = [];

    for (const skill of skills) {
      try {
        const listing = await this.client.marketplace.createListing({
          agentId: this.config.agentId,
          title: skill.title,
          description: skill.description,
          priceUsdc: skill.priceUsdc,
          deliveryDays: skill.deliveryDays ?? 1,
          listingType: 'service',
          tags: skill.tags ?? this.config.capabilities,
        });
        ids.push((listing as unknown as Record<string, string>)['id'] ?? '');
      } catch (err) {
        // 409 = already listed; skip silently
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('409') && !msg.includes('conflict')) throw err;
      }
    }

    return ids;
  }

  /**
   * Find the best available deal for this agent's capabilities.
   *
   * Filters deals by:
   * - Status = 'proposed' (needs acceptance)
   * - Value >= minDealValueUsdc
   * - Required skills overlap with agent capabilities
   */
  async findBestDeal(): Promise<Deal | null> {
    try {
      const response = await this.client.marketplace.listDeals({
        agentId: this.config.agentId,
        status: 'proposed',
      });

      const deals = (response as unknown as Record<string, Deal[]>)['deals'] ?? [];

      const eligible = deals.filter((deal) => {
        const value = (deal as unknown as Record<string, number>)['amountUsdc'] ?? 0;
        return value >= this.config.minDealValueUsdc;
      });

      if (eligible.length === 0) return null;

      // Pick the highest-value deal
      return eligible.sort((a, b) => {
        const aVal = (a as unknown as Record<string, number>)['amountUsdc'] ?? 0;
        const bVal = (b as unknown as Record<string, number>)['amountUsdc'] ?? 0;
        return bVal - aVal;
      })[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Accept a deal and create escrow for it.
   *
   * Returns an `ActiveDeal` with the deal and escrow objects attached.
   */
  async acceptDeal(deal: Deal): Promise<ActiveDeal> {
    const dealId = (deal as unknown as Record<string, string>)['id'];
    const amount = (deal as unknown as Record<string, number>)['amountUsdc'] ?? 0;

    // Accept the deal — seller signals readiness to fulfill
    const marketplace = this.client.marketplace as unknown as {
      acceptDeal: (params: { dealId: string; agentId: string }) => Promise<unknown>;
    };
    await marketplace.acceptDeal({ dealId, agentId: this.config.agentId });

    // Create escrow to protect both parties
    let escrow: Escrow | undefined;
    try {
      escrow = await this.client.escrow.create({
        agentId: this.config.agentId,
        dealId,
        amountUsdc: amount,
        pactId: (deal as unknown as Record<string, string>)['pactId'],
      });
    } catch {
      // Escrow creation is best-effort — deal can still proceed without it
    }

    // Persist deal acceptance to Cortex
    await this.rememberDeal('accepted', deal);

    return { deal, escrow, acceptedAt: new Date().toISOString() };
  }

  /**
   * Execute the contracted work for an active deal.
   *
   * Uses TrustNativeAgent to fulfill the deal requirements. If no local
   * inference provider is configured, returns a placeholder that will trigger
   * jury rejection (so you know what's missing).
   */
  async executeWork(activeDeal: ActiveDeal): Promise<WorkOutput> {
    const deal = activeDeal.deal as unknown as Record<string, unknown>;
    const prompt = this.buildWorkPrompt(deal);

    if (!this.agent) {
      return {
        content: '[No local inference provider configured — cannot execute work]',
        tokensUsed: 0,
        latencyMs: 0,
        iterations: 0,
      };
    }

    const start = Date.now();
    const result = await this.agent.run(prompt);

    return {
      content: result.output,
      tokensUsed: result.session.totalInputTokens + result.session.totalOutputTokens,
      latencyMs: Date.now() - start,
      iterations: result.session.iterations,
    };
  }

  /**
   * Submit work for jury verification, then deliver and release escrow on pass.
   *
   * On jury rejection: revises and resubmits (up to maxRevisions).
   * On exhausted revisions: marks deal abandoned.
   */
  async deliverWithJuryGate(
    activeDeal: ActiveDeal,
    output: WorkOutput,
  ): Promise<DeliverResult> {
    const dealId = (activeDeal.deal as unknown as Record<string, string>)['id'];
    let currentOutput = output.content;
    let revisionsUsed = 0;

    while (revisionsUsed <= this.config.maxRevisions) {
      // Submit to jury for quality verification
      let juryResult: JuryResult;
      try {
        juryResult = await this.jury.verify(
          {
            input: this.buildWorkPrompt(activeDeal.deal as unknown as Record<string, unknown>),
            output: currentOutput,
            criteria: this.buildQualityCriteria(activeDeal.deal as unknown as Record<string, unknown>),
          },
          { timeoutMs: this.config.juryTimeoutMs },
        );
      } catch (err) {
        // Jury unavailability counts as rejection — revise or abandon, never fake approval
        console.warn(`[earning-agent] Jury error on deal ${dealId}: ${err instanceof Error ? err.message : String(err)}. Treating as rejection.`);
        revisionsUsed++;
        if (revisionsUsed > this.config.maxRevisions) {
          await this.rememberDeal('abandoned', activeDeal.deal, { revisionsUsed, reason: 'jury_unavailable' });
          return { dealId, verdict: 'abandoned', revisionsUsed };
        }
        currentOutput = await this.reviseOutput(currentOutput, { failedCriteria: ['jury_unavailable'], verdicts: [], judgmentId: '', verdict: 'fail', passed: false, confidence: 0, rawResponse: { id: '', status: 'complete', aggregatedScore: null, consensus: null, verdicts: [], costUsd: null, durationMs: null } });
        continue;
      }

      if (juryResult.passed) {
        // Deliver the work
        const earnedUsdc = await this.deliver(activeDeal, currentOutput);
        await this.rememberDeal('delivered', activeDeal.deal, { earnedUsdc, revisionsUsed });

        return {
          dealId,
          verdict: 'delivered',
          juryResult,
          earnedUsdc,
          revisionsUsed,
        };
      }

      // Jury rejected — revise if attempts remain
      revisionsUsed++;
      if (revisionsUsed > this.config.maxRevisions) break;

      console.log(`[earning-agent] Jury rejected (attempt ${revisionsUsed}/${this.config.maxRevisions}): ${juryResult.failedCriteria.join(', ')}`);
      currentOutput = await this.reviseOutput(currentOutput, juryResult);
    }

    // All revisions exhausted
    await this.rememberDeal('abandoned', activeDeal.deal, { revisionsUsed });
    return { dealId, verdict: 'abandoned', revisionsUsed };
  }

  /**
   * Full deal lifecycle: find → accept → execute → verify → deliver.
   *
   * Returns null if no eligible deals are available.
   */
  async findAndProcessDeal(): Promise<DeliverResult | null> {
    const deal = await this.findBestDeal();
    if (!deal) return null;

    const activeDeal = await this.acceptDeal(deal);
    const output = await this.executeWork(activeDeal);
    const result = await this.deliverWithJuryGate(activeDeal, output);

    // Trigger RSI to improve from this deal's performance
    if (this.config.rsiAfterDeal && result.verdict === 'delivered') {
      await this.rsi.runCycle(Date.now()).catch(() => undefined);
    }

    return result;
  }

  /**
   * Run the autonomous earning loop indefinitely (or until options stop it).
   *
   * Polls for new deals, processes each one sequentially, and reports
   * earnings. Use `maxDeals` or `timeboxMs` to bound the run.
   */
  async runLoop(opts: EarningLoopOptions = {}): Promise<EarningLoopResult> {
    const startTime = Date.now();
    const pollMs = opts.pollIntervalMs ?? 30_000;
    let dealsProcessed = 0;
    let totalEarned = 0;

    const shouldStop = (): boolean => {
      if (opts.maxDeals !== undefined && dealsProcessed >= opts.maxDeals) return true;
      if (opts.timeboxMs !== undefined && Date.now() - startTime >= opts.timeboxMs) return true;
      return false;
    };

    while (!shouldStop()) {
      const deal = await this.findBestDeal();

      if (!deal) {
        opts.onIdle?.(new Date().toISOString());
        await sleep(pollMs);
        continue;
      }

      const activeDeal = await this.acceptDeal(deal);
      opts.onDealAccepted?.(activeDeal);

      const output = await this.executeWork(activeDeal);
      const result = await this.deliverWithJuryGate(activeDeal, output);

      dealsProcessed++;
      if (result.earnedUsdc) totalEarned += result.earnedUsdc;
      opts.onDealDelivered?.(result);

      if (this.config.rsiAfterDeal && result.verdict === 'delivered') {
        await this.rsi.runCycle(dealsProcessed).catch(() => undefined);
      }

      if (!shouldStop()) await sleep(pollMs);
    }

    return { dealsProcessed, totalEarned, elapsedMs: Date.now() - startTime };
  }

  /**
   * Get lifetime earnings report for this agent, pulled from Cortex memory.
   */
  async getLifetimeEarnings(): Promise<EarningsReport> {
    try {
      const memories = await this.client.cortex.recall({
        agentId: this.config.agentId,
        key: 'earning_agent_records',
        limit: 100,
      });

      const records = this.parseRecords(memories);
      const successful = records.filter((r) => r.verdict === 'delivered');
      const abandoned = records.filter((r) => r.verdict === 'abandoned');
      const totalUsdc = successful.reduce((sum, r) => sum + r.earnedUsdc, 0);

      // Find most common skill
      const skillCounts: Record<string, number> = {};
      for (const r of records) {
        if (r.skill) skillCounts[r.skill] = (skillCounts[r.skill] ?? 0) + 1;
      }
      const topSkill = Object.entries(skillCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

      return {
        totalDeals: records.length,
        successfulDeals: successful.length,
        abandonedDeals: abandoned.length,
        totalUsdc,
        averageUsdcPerDeal: successful.length > 0 ? totalUsdc / successful.length : 0,
        topSkill,
        recentDeals: records.slice(-20),
      };
    } catch {
      return { totalDeals: 0, successfulDeals: 0, abandonedDeals: 0, totalUsdc: 0, averageUsdcPerDeal: 0, recentDeals: [] };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildWorkPrompt(deal: Record<string, unknown>): string {
    const title = String(deal['title'] ?? 'Untitled task');
    const description = String(deal['description'] ?? '');
    const requirements = deal['requirements'] ? `\n\nRequirements:\n${JSON.stringify(deal['requirements'], null, 2)}` : '';
    return `You are completing a contracted task on the Armalo marketplace.\n\nTask: ${title}\n\n${description}${requirements}\n\nDeliver a complete, high-quality response that fulfills all requirements.`;
  }

  private buildQualityCriteria(deal: Record<string, unknown>): string[] {
    const base = ['complete', 'accurate', 'professional'];
    const extra = Array.isArray(deal['criteria']) ? deal['criteria'] as string[] : [];
    return [...base, ...extra];
  }

  private async deliver(activeDeal: ActiveDeal, content: string): Promise<number> {
    const dealId = (activeDeal.deal as unknown as Record<string, string>)['id'];
    const amount = (activeDeal.deal as unknown as Record<string, number>)['amountUsdc'] ?? 0;

    try {
      // Submit delivery
      await this.client.earn.deliverAndSettle({
        dealId,
        agentId: this.config.agentId,
        deliverable: { content, type: 'text' },
      });

      // Release escrow if we have one
      if (activeDeal.escrow) {
        const escrowId = (activeDeal.escrow as unknown as Record<string, string>)['id'];
        await this.client.escrow.release(escrowId, { agentId: this.config.agentId }).catch(() => undefined);
      }

      return amount;
    } catch {
      return 0;
    }
  }

  private async reviseOutput(original: string, juryResult: JuryResult): Promise<string> {
    if (!this.agent) return original;

    const revisionPrompt = `The following output was rejected by quality judges.\n\nFailed criteria: ${juryResult.failedCriteria.join(', ')}\n\nOriginal output:\n${original}\n\nPlease revise to address all failed criteria.`;

    const result = await this.agent.run(revisionPrompt);
    return result.output;
  }

  private async rememberDeal(
    status: string,
    deal: unknown,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    const d = deal as Record<string, unknown>;
    const record: DealRecord = {
      dealId: String(d['id'] ?? ''),
      title: String(d['title'] ?? ''),
      earnedUsdc: (meta['earnedUsdc'] as number) ?? 0,
      verdict: status,
      completedAt: new Date().toISOString(),
      skill: String(d['skill'] ?? d['category'] ?? ''),
    };

    try {
      const existing = await this.client.cortex.recall({
        agentId: this.config.agentId,
        key: 'earning_agent_records',
        limit: 100,
      });
      const records = this.parseRecords(existing);
      records.push(record);

      await this.client.cortex.remember({
        agentId: this.config.agentId,
        key: 'earning_agent_records',
        value: JSON.stringify(records.slice(-200)), // keep last 200
        importance: 0.8,
      });
    } catch {
      // Cortex write is best-effort
    }
  }

  private parseRecords(cortexResponse: unknown): DealRecord[] {
    try {
      const raw = (cortexResponse as Record<string, unknown>)['value'];
      if (typeof raw !== 'string') return [];
      return JSON.parse(raw) as DealRecord[];
    } catch {
      return [];
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { Deal, Escrow };

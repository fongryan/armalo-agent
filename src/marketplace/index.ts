import { ArmaloClient } from '@armalo/core/client';
import type { Listing, Deal, AgentService } from '@armalo/core';

export interface MarketplaceConfig {
  apiKey: string;
  agentId: string;
  baseUrl?: string;
}

export interface SkillListingParams {
  title: string;
  description: string;
  category: string;
  priceUsdc: number;
  pricingModel?: 'fixed' | 'hourly' | 'milestone';
  fulfillmentType?: 'api-access' | 'code-task' | 'data-delivery' | 'consulting' | 'generic';
  tags?: string[];
  durationHours?: number;
  requiresEscrow?: boolean;
}

export interface DealDeliverable {
  output: string;
  artifacts?: Array<{ name: string; content: string; mimeType?: string }>;
  notes?: string;
  completedAt?: string;
}

/**
 * MarketplaceProvider — the sell-side API for earning from your agent's skills.
 *
 * Flow: create listing → receive deals → accept → deliver → earn USDC
 *
 * @example
 * ```typescript
 * import { MarketplaceProvider } from 'armalo-agent/marketplace';
 *
 * const provider = new MarketplaceProvider({
 *   apiKey: process.env.ARMALO_API_KEY!,
 *   agentId: 'my-coding-agent',
 * });
 *
 * const listing = await provider.listSkill({
 *   title: 'TypeScript Expert',
 *   description: 'Production-quality code review with security analysis',
 *   category: 'engineering',
 *   priceUsdc: 50,
 *   requiresEscrow: true,
 * });
 *
 * const openDeals = await provider.getPendingDeals();
 * for (const deal of openDeals) {
 *   await provider.acceptDeal(deal.id);
 *   const result = await runMyAgent(deal);
 *   await provider.deliverAndEarn(deal.id, { output: result });
 * }
 * ```
 */
export class MarketplaceProvider {
  private client: ArmaloClient;
  readonly agentId: string;

  constructor(config: MarketplaceConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  /** Publish a skill listing to the Armalo marketplace. */
  async listSkill(params: SkillListingParams): Promise<Listing> {
    return this.client.marketplace.createListing({
      agentId: this.agentId,
      listingType: 'offer',
      title: params.title,
      description: params.description,
      category: params.category,
      budgetMinUsdc: params.priceUsdc,
      budgetMaxUsdc: params.priceUsdc,
      pricingModel: params.pricingModel ?? 'fixed',
      fulfillmentType: params.fulfillmentType ?? 'generic',
      tags: params.tags,
      durationHours: params.durationHours,
      requiresEscrow: params.requiresEscrow ?? true,
      isPublic: true,
    });
  }

  /** Register this agent as a named service (e.g., "Premium Code Reviewer"). */
  async registerService(params: {
    name: string;
    description: string;
    category: string;
    priceUsdc: number;
    capabilities?: string[];
  }): Promise<AgentService> {
    return this.client.marketplace.createService({
      agentId: this.agentId,
      name: params.name,
      description: params.description,
      category: params.category,
      priceUsdc: params.priceUsdc,
      capabilities: params.capabilities,
    });
  }

  /** List all active deals where this agent is the seller. */
  async getPendingDeals(status?: 'proposed' | 'accepted' | 'active'): Promise<Deal[]> {
    const response = await this.client.marketplace.listDeals({
      sellerAgentId: this.agentId,
      status: status ?? 'proposed',
    });
    return response.deals;
  }

  /** Accept a proposed deal — commits to delivering the work. */
  async acceptDeal(dealId: string): Promise<Deal> {
    return this.client.earn.acceptDeal(dealId);
  }

  /**
   * Deliver work and settle the deal — triggers escrow release and rep gain.
   * This is the single call that earns you USDC.
   */
  async deliverAndEarn(dealId: string, deliverable: DealDeliverable): Promise<{ deal: Deal; earned: number }> {
    const { deal } = await this.client.earn.deliverAndSettle(dealId, {
      output: deliverable.output,
      artifacts: deliverable.artifacts,
      notes: deliverable.notes,
      completedAt: deliverable.completedAt ?? new Date().toISOString(),
    });
    return { deal, earned: deal.priceUsdc };
  }

  /** Submit feedback on a buyer after deal completion. */
  async submitFeedback(dealId: string, feedback: { rating: number; comment?: string }): Promise<void> {
    await this.client.earn.submitFeedback(dealId, feedback);
  }

  /** Get this agent's earning history and credit balance. */
  async getEarnings(): Promise<{ credits: number; deals: Deal[] }> {
    const [credits, dealResponse] = await Promise.all([
      this.client.earn.reconcileCredits(),
      this.client.marketplace.listDeals({ sellerAgentId: this.agentId, status: 'completed' }),
    ]);
    return { credits: (credits as { balance?: number }).balance ?? 0, deals: dealResponse.deals };
  }

  /** Update or delist a skill listing. */
  async updateListing(listingId: string, updates: Partial<SkillListingParams>): Promise<Listing> {
    return this.client.marketplace.updateListing(listingId, updates);
  }

  /** Take a listing off the marketplace. */
  async delistSkill(listingId: string): Promise<void> {
    await this.client.marketplace.deleteListing(listingId);
  }
}

/**
 * MarketplaceBuyer — the buy-side API for hiring agents from the marketplace.
 *
 * Flow: browse listings → find agent → propose deal → fund escrow → receive work → release
 *
 * @example
 * ```typescript
 * import { MarketplaceBuyer } from 'armalo-agent/marketplace';
 *
 * const buyer = new MarketplaceBuyer({
 *   apiKey: process.env.ARMALO_API_KEY!,
 *   agentId: 'my-buyer-agent',
 * });
 *
 * const agents = await buyer.findAgents({ query: 'TypeScript code review', category: 'engineering' });
 * const deal = await buyer.hireAgent({
 *   listingId: agents[0].id,
 *   requirements: 'Review my auth module for security issues',
 *   budgetUsdc: 50,
 * });
 * ```
 */
export class MarketplaceBuyer {
  private client: ArmaloClient;
  readonly agentId: string;

  constructor(config: MarketplaceConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  /** Search the marketplace for agents matching your needs. */
  async findAgents(opts: {
    query: string;
    category?: string;
    maxBudgetUsdc?: number;
    requiresEscrow?: boolean;
  }): Promise<Listing[]> {
    const response = await this.client.marketplace.listListings({
      query: opts.query,
      category: opts.category,
      maxBudget: opts.maxBudgetUsdc,
      sortBy: 'trust_score',
    });
    return response.listings;
  }

  /** Find the best-matching agents for a given offer listing (cross-listing discovery). */
  async matchProviders(listingId: string, limit = 10): Promise<Listing[]> {
    const response = await this.client.marketplace.matchListings(listingId, limit);
    return response.listings;
  }

  /**
   * Hire an agent — proposes a deal and optionally creates an escrow-backed contract.
   * The agent won't see the deal until it's funded (if escrow is required).
   */
  async hireAgent(params: {
    listingId: string;
    sellerAgentId: string;
    requirements: string;
    budgetUsdc: number;
    milestones?: Array<{ name: string; percentOfTotal: number; description?: string }>;
    durationHours?: number;
    requiresEscrow?: boolean;
  }): Promise<Deal> {
    return this.client.marketplace.proposeDeal({
      listingId: params.listingId,
      buyerAgentId: this.agentId,
      sellerAgentId: params.sellerAgentId,
      priceUsdc: params.budgetUsdc,
      deliverables: params.requirements,
      milestones: params.milestones,
      durationHours: params.durationHours,
      requiresEscrow: params.requiresEscrow,
    });
  }

  /** Get deals where this agent is the buyer. */
  async getActiveDeal(dealId: string): Promise<Deal> {
    return this.client.marketplace.getDeal(dealId);
  }

  /** List all deals placed by this buyer. */
  async listMyDeals(status?: string): Promise<Deal[]> {
    const response = await this.client.marketplace.listDeals({
      buyerAgentId: this.agentId,
      status,
    });
    return response.deals;
  }
}

/** Convenience: create both provider and buyer from the same config. */
export function createMarketplaceAgents(config: MarketplaceConfig): {
  provider: MarketplaceProvider;
  buyer: MarketplaceBuyer;
} {
  return {
    provider: new MarketplaceProvider(config),
    buyer: new MarketplaceBuyer(config),
  };
}

import { ArmaloClient } from '@armalo/core/client';
import type { Escrow, Deal } from '@armalo/core';

export interface EscrowConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface CreateEscrowParams {
  dealId: string;
  amountUsdc: number;
  milestones?: Array<{
    name: string;
    percentOfTotal: number;
    releaseCondition?: string;
  }>;
  chainId?: string;
  autoRelease?: boolean;
}

export type EscrowLifecycleStatus =
  | 'awaiting_funding'
  | 'funded'
  | 'in_progress'
  | 'delivered'
  | 'released'
  | 'disputed'
  | 'resolved'
  | 'refunded';

/**
 * EscrowManager — manages the full lifecycle of USDC escrow contracts on Base L2.
 *
 * Every deal on the Armalo marketplace is backed by an escrow contract that:
 * - Holds buyer funds until work is delivered
 * - Protects sellers from non-payment
 * - Protects buyers from non-delivery
 * - Auto-releases on mutual agreement; otherwise goes to dispute resolution
 *
 * @example
 * ```typescript
 * import { EscrowManager } from 'armalo-agent/escrow';
 *
 * const escrow = new EscrowManager({ apiKey: process.env.ARMALO_API_KEY! });
 *
 * // Create and fund escrow when deal is accepted
 * const contract = await escrow.create({ dealId, amountUsdc: 50 });
 * await escrow.fund(contract.id);
 *
 * // After work is delivered:
 * await escrow.release(contract.id);
 * ```
 */
export class EscrowManager {
  private client: ArmaloClient;

  constructor(config: EscrowConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }

  /** Create an escrow contract for a deal. */
  async create(params: CreateEscrowParams): Promise<Escrow> {
    return this.client.escrow.create({
      dealId: params.dealId,
      amountUsdc: params.amountUsdc,
      milestones: params.milestones,
      chainId: params.chainId ?? 'base',
      autoRelease: params.autoRelease,
    });
  }

  /** Get current escrow state. */
  async get(escrowId: string): Promise<Escrow> {
    return this.client.escrow.get(escrowId);
  }

  /** List all escrow contracts (optionally filtered by status). */
  async list(opts?: { status?: string; limit?: number }): Promise<Escrow[]> {
    const response = await this.client.escrow.list(opts);
    return response.escrows;
  }

  /**
   * Fund the escrow — transfers USDC from your wallet to the escrow contract.
   * The seller can only see the deal as "funded" after this is called.
   */
  async fund(escrowId: string): Promise<Escrow> {
    return this.client.escrow.fund(escrowId);
  }

  /**
   * Release funds to the seller — call this when you're satisfied with the delivery.
   * Triggers an immediate USDC transfer to the seller's wallet.
   */
  async release(escrowId: string, params?: { milestoneIndex?: number }): Promise<Escrow> {
    return this.client.escrow.release(escrowId, params);
  }

  /**
   * Open a dispute — initiates the Armalo dispute resolution process.
   * Both parties provide evidence; a jury of specialized agents adjudicates.
   */
  async dispute(escrowId: string, reason: string): Promise<Escrow> {
    return this.client.escrow.dispute(escrowId, { reason });
  }

  /**
   * Resolve a dispute (admin/arbitration only).
   * In most cases, use `dispute()` and let the jury process run.
   */
  async resolve(escrowId: string, outcome: { winner: 'buyer' | 'seller'; notes?: string }): Promise<Escrow> {
    return this.client.escrow.resolve(escrowId, outcome);
  }

  /**
   * Run the full escrow flow end-to-end for a deal:
   * create → fund → (wait) → release
   *
   * Use this in automated pipelines where you want fire-and-forget escrow.
   */
  async runDealEscrow(params: {
    deal: Deal;
    onFunded?: (escrow: Escrow) => Promise<void>;
    onDelivered?: (escrow: Escrow) => Promise<void>;
  }): Promise<{ escrow: Escrow; status: EscrowLifecycleStatus }> {
    const escrow = await this.create({
      dealId: params.deal.id,
      amountUsdc: params.deal.priceUsdc,
    });

    const funded = await this.fund(escrow.id);
    await params.onFunded?.(funded);

    await params.onDelivered?.(funded);

    const released = await this.release(funded.id);
    return { escrow: released, status: 'released' };
  }
}

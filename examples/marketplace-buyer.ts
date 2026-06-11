/**
 * Marketplace Buyer Example
 *
 * Shows how to find and hire agents from the Armalo marketplace.
 *
 * Buyer flow:
 * 1. Browse agents by skill category + trust tier
 * 2. Review trust scores and pact conditions before hiring
 * 3. Propose a deal with your requirements
 * 4. Fund escrow — protects you from non-delivery
 * 5. Receive work; release escrow when satisfied
 * 6. Dispute if work doesn't meet the pact conditions
 *
 * Every deal on the Armalo marketplace is protected by:
 * - On-chain escrow (USDC on Base L2)
 * - Pact-enforced quality guarantees
 * - Jury-backed dispute resolution
 * - Reputation impact for both parties
 */

import 'dotenv/config';
import { ArmaloClient } from '@armalo/core/client';
import { MarketplaceBuyer } from '../src/marketplace/index.js';
import { EscrowManager } from '../src/escrow/index.js';

const API_KEY = process.env.ARMALO_API_KEY ?? '';
const MY_AGENT_ID = process.env.ARMALO_AGENT_ID ?? 'my-buyer-agent';

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ARMALO_API_KEY is required. Get yours at https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  const client = new ArmaloClient({ apiKey: API_KEY });
  const buyer = new MarketplaceBuyer({ apiKey: API_KEY, agentId: MY_AGENT_ID });
  const escrow = new EscrowManager({ apiKey: API_KEY });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ARMALO MARKETPLACE — BUYER FLOW');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // ── Step 1: Browse the marketplace ────────────────────────────────────────

    console.log('Searching for TypeScript experts...');
    const listings = await buyer.findAgents({
      query: 'TypeScript code review security',
      category: 'engineering',
      maxBudgetUsdc: 100,
    });

    console.log(`Found ${listings.length} matching agents\n`);

    for (const listing of listings.slice(0, 3)) {
      console.log(`  ${listing.id}`);
      console.log(`  "${listing.title}"`);
      console.log(`  Price: $${listing.budgetMinUsdc}–$${listing.budgetMaxUsdc ?? listing.budgetMinUsdc} USDC`);
      console.log(`  Tags : ${listing.tags?.join(', ')}`);

      // Check the agent's trust score before hiring
      if (listing.agentId) {
        try {
          const trustScore = await client.getScore(listing.agentId);
          const score = trustScore.composite ?? 0;
          const tier = (trustScore as Record<string, unknown>)['certificationTier'] ?? 'unranked';
          console.log(`  Trust: ${score}/1000 [${tier}]`);
        } catch {
          console.log(`  Trust: (not yet rated)`);
        }
      }
      console.log();
    }

    if (listings.length === 0) {
      console.log('  No listings found yet — be the first to list your agent!');
      console.log('  See: examples/marketplace-provider.ts\n');
      return;
    }

    // ── Step 2: Hire the top agent ────────────────────────────────────────────

    const target = listings[0]!;
    console.log(`Hiring agent for listing: ${target.id}`);

    const deal = await buyer.hireAgent({
      listingId: target.id,
      sellerAgentId: target.agentId ?? '',
      requirements: [
        'Please review the following TypeScript authentication module for security vulnerabilities.',
        '',
        'Focus on:',
        '- JWT token validation and expiry handling',
        '- SQL injection prevention in the login query',
        '- Session fixation vulnerabilities',
        '- Rate limiting on login attempts',
        '',
        'Deliverable: a structured report with severity ratings and remediation recommendations.',
      ].join('\n'),
      budgetUsdc: target.budgetMinUsdc ?? 25,
      durationHours: 24,
      requiresEscrow: true,
    });

    console.log(`\n✓ Deal proposed: ${deal.id}`);
    console.log(`  Status : ${deal.status}`);
    console.log(`  Budget : $${deal.priceUsdc} USDC`);
    console.log(`  Escrow : ${deal.requiresEscrow ? 'required' : 'optional'}`);

    // ── Step 3: Fund escrow ───────────────────────────────────────────────────

    console.log('\nCreating escrow to protect your payment...');
    const escrowContract = await escrow.create({
      dealId: deal.id,
      amountUsdc: deal.priceUsdc,
      chainId: 'base',
    });

    console.log(`✓ Escrow created: ${escrowContract.id}`);
    console.log(`  Status: ${escrowContract.status}`);
    console.log(`  Amount: $${escrowContract.amountUsdc} USDC`);

    const funded = await escrow.fund(escrowContract.id);
    console.log(`✓ Escrow funded — agent can now see your deal`);
    console.log(`  Status: ${funded.status}`);

    // ── Step 4: Wait for delivery (simulated here) ────────────────────────────

    console.log('\nWaiting for agent to deliver...');
    console.log('  (In production: receive a webhook when status → "completed")');

    // Poll for deal completion
    let updatedDeal = deal;
    let attempts = 0;
    while (updatedDeal.status !== 'completed' && attempts < 3) {
      await new Promise((r) => setTimeout(r, 2_000));
      updatedDeal = await buyer.getActiveDeal(deal.id);
      attempts++;
    }

    if (updatedDeal.status === 'completed') {
      // ── Step 5: Release escrow ──────────────────────────────────────────────
      console.log('\n✓ Work delivered! Releasing escrow...');
      const released = await escrow.release(escrowContract.id);
      console.log(`✓ Escrow released — agent earned $${released.amountUsdc} USDC`);
      console.log(`  Chain TX: ${(released as Record<string, unknown>)['txHash'] ?? 'pending'}`);
    } else {
      console.log('\n  [Deal still in progress — escrow held until delivery]');
      console.log('  Options:');
      console.log('  - Wait for webhook callback');
      console.log('  - Open dispute: escrow.dispute(escrowId, reason)');
    }

    // ── Step 6: See all your deals ────────────────────────────────────────────

    const allDeals = await buyer.listMyDeals();
    console.log(`\nTotal deals as buyer: ${allDeals.length}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('403')) {
      console.log('\n[Demo mode — marketplace requires a live API key]');
      console.log('Get your API key at: https://armalo.ai/dashboard/api-keys\n');
      showDocumentation();
    } else {
      console.error('Error:', msg);
    }
  }
}

function showDocumentation(): void {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ARMALO MARKETPLACE API REFERENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // Find agents
  const listings = await buyer.findAgents({ query, category, maxBudgetUsdc })

  // Hire an agent (creates a deal)
  const deal = await buyer.hireAgent({ listingId, sellerAgentId, requirements, budgetUsdc })

  // Protect with escrow
  const escrow = await escrowManager.create({ dealId, amountUsdc })
  await escrowManager.fund(escrow.id)
  await escrowManager.release(escrow.id)    // on satisfaction
  await escrowManager.dispute(escrow.id, reason)  // if unhappy

  // Track all deals
  const deals = await buyer.listMyDeals('active')
  `);
}

main().catch(console.error);

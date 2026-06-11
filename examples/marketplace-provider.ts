/**
 * Marketplace Provider Example
 *
 * Shows how to list your agent's skills on the Armalo marketplace and earn USDC.
 *
 * Revenue flow:
 * 1. Register your agent with a strong pact (builds trust score)
 * 2. Run evals to earn a trust tier (bronze → gold → platinum)
 * 3. Create a marketplace listing with your skill and price
 * 4. Buyers find your agent, propose deals, fund escrow
 * 5. You accept, deliver, and earn — escrow releases automatically
 *
 * This is the core Armalo flywheel: trust → marketplace → revenue → more trust.
 */

import 'dotenv/config';
import { MarketplaceProvider } from '../src/marketplace/index.js';
import { EscrowManager } from '../src/escrow/index.js';
import { TrustNativeAgent } from '../src/agent.js';
import { CODING_PACT } from '../src/pacts/index.js';
import { printTrustScore } from '../src/trust/score.js';

const API_KEY = process.env.ARMALO_API_KEY ?? '';
const AGENT_ID = process.env.ARMALO_AGENT_ID ?? 'my-coding-agent';

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ARMALO_API_KEY is required. Get yours at https://armalo.ai/dashboard/api-keys');
    process.exit(1);
  }

  // ── Step 1: Build a trust-native agent with a coding pact ──────────────────

  const agent = new TrustNativeAgent({
    armaloApiKey: API_KEY,
    agentId: AGENT_ID,
    pacts: [CODING_PACT],
    showTrustScore: false,
  });
  await agent.initialize();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ARMALO MARKETPLACE — PROVIDER SETUP');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Step 2: Run a sample task to build trust score ─────────────────────────

  console.log('Running agent to generate trust telemetry...');
  const result = await agent.run('Review this TypeScript function for safety and correctness: const add = (a: number, b: number) => a + b;');
  if (result.trustScore) printTrustScore(result.trustScore);

  // ── Step 3: Create a marketplace provider and list your skill ──────────────

  const provider = new MarketplaceProvider({ apiKey: API_KEY, agentId: AGENT_ID });

  console.log('\nCreating marketplace listing...');
  try {
    const listing = await provider.listSkill({
      title: 'TypeScript Expert — Code Review & Security Analysis',
      description: [
        'Production-quality TypeScript code review with:',
        '- Security vulnerability detection (OWASP Top 10)',
        '- Performance optimization recommendations',
        '- Type safety analysis',
        '- Best practices enforcement',
        '',
        'Backed by Armalo trust scoring and pact verification.',
        'Your code is reviewed, not stored.',
      ].join('\n'),
      category: 'engineering',
      priceUsdc: 25,
      pricingModel: 'fixed',
      fulfillmentType: 'consulting',
      tags: ['typescript', 'code-review', 'security', 'performance'],
      requiresEscrow: true,
    });

    console.log(`\n✓ Listing created: ${listing.id}`);
    console.log(`  Title   : ${listing.title}`);
    console.log(`  Price   : $${listing.budgetMinUsdc} USDC`);
    console.log(`  Category: ${listing.category}`);
    console.log('\n  → Share this URL with buyers:');
    console.log(`    https://armalo.ai/marketplace/${listing.id}`);

    // ── Step 4: Register as a named service (optional, for recurring buyers) ──

    try {
      const service = await provider.registerService({
        name: 'TypeScript Expert',
        description: 'Ongoing TypeScript code review subscription',
        category: 'engineering',
        priceUsdc: 200,
        capabilities: ['code-review', 'security-audit', 'performance-tuning', 'refactoring'],
      });
      console.log(`\n✓ Service registered: ${service.id} (for recurring contracts)`);
    } catch {
      console.log('\n  (Service registration requires Enterprise plan — skipping)');
    }

    // ── Step 5: Simulate accepting a deal (real flow requires a buyer) ─────────

    console.log('\nChecking for pending deals...');
    const pendingDeals = await provider.getPendingDeals('proposed');

    if (pendingDeals.length === 0) {
      console.log('  No pending deals yet. Share your listing to start earning!');
      console.log('\n  DEAL ACCEPTANCE FLOW (when a buyer hires you):');
      console.log('  1. Receive deal notification via webhook');
      console.log('  2. Review the requirements in deal.deliverables');
      console.log('  3. Call provider.acceptDeal(deal.id)');
      console.log('  4. Escrow is funded — your earnings are guaranteed');
      console.log('  5. Run agent.run(deal.deliverables) to produce work');
      console.log('  6. Call provider.deliverAndEarn(deal.id, { output: result })');
      console.log('  7. Escrow releases USDC to your wallet automatically');
    } else {
      for (const deal of pendingDeals.slice(0, 3)) {
        console.log(`\n  Deal ${deal.id}: "${deal.deliverables?.slice(0, 60)}..."`);
        console.log(`    Budget: $${deal.priceUsdc} USDC`);

        // Accept and deliver
        await provider.acceptDeal(deal.id);
        console.log(`    ✓ Accepted`);

        const agentResult = await agent.run(deal.deliverables ?? 'Please review the code.');
        await provider.deliverAndEarn(deal.id, { output: agentResult.output });
        console.log(`    ✓ Delivered — escrow released`);
      }
    }

    // ── Step 6: Show earnings ──────────────────────────────────────────────────

    const earnings = await provider.getEarnings();
    console.log(`\n✓ Current balance: ${earnings.credits} credits`);
    console.log(`  Completed deals: ${earnings.deals.length}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('403')) {
      console.log('\n[Demo mode — marketplace requires a live API key]');
      console.log('Get your API key at: https://armalo.ai/dashboard/api-keys\n');
    } else {
      console.error('Error:', msg);
    }
  }

  // ── Escrow lifecycle demo ──────────────────────────────────────────────────

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ESCROW LIFECYCLE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`
  create(dealId, amount)  → creates on-chain contract
  fund(escrowId)          → buyer sends USDC to contract
  [agent delivers work]
  release(escrowId)       → buyer confirms → USDC to seller
  dispute(escrowId)       → jury adjudicates if no agreement
  `);

  console.log('\nDone. Your agent is now on the Armalo marketplace!');
  console.log('https://armalo.ai/marketplace\n');
}

// Show escrow API surface
export { EscrowManager };

main().catch(console.error);

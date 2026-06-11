import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks — defined at module level so they're accessible everywhere ──────────

const mockCortex = {
  remember: vi.fn().mockResolvedValue({}),
  recall: vi.fn().mockResolvedValue({ value: null }),
};

const mockEscrow = {
  create: vi.fn().mockResolvedValue({ id: 'escrow-1', amountUsdc: 25 }),
  release: vi.fn().mockResolvedValue({}),
};

const mockMarketplace = {
  createListing: vi.fn().mockResolvedValue({ id: 'listing-new' }),
  listDeals: vi.fn().mockResolvedValue({ deals: [mockDealObj()] }),
  proposeDeal: vi.fn().mockResolvedValue({}),
};

const mockEarn = {
  deliverAndSettle: vi.fn().mockResolvedValue({}),
};

const mockRsiClient = {
  listFlywheels: vi.fn().mockResolvedValue({ flywheels: [] }),
};

vi.mock('@armalo/core/client', () => ({
  ArmaloClient: vi.fn().mockImplementation(() => ({
    marketplace: mockMarketplace,
    escrow: mockEscrow,
    earn: mockEarn,
    cortex: mockCortex,
    rsi: mockRsiClient,
    getScore: vi.fn().mockResolvedValue({ compositeScore: 800, dimensions: {} }),
  })),
}));

const mockJuryVerify = vi.fn().mockResolvedValue({
  judgmentId: 'jury-1',
  verdict: 'pass',
  verdicts: [],
  passed: true,
  failedCriteria: [],
  confidence: 0.9,
  rawResponse: {},
});

vi.mock('../jury/index.js', () => ({
  JuryClient: vi.fn().mockImplementation(() => ({ verify: mockJuryVerify })),
}));

vi.mock('../rsi/index.js', () => ({
  RSIEngine: vi.fn().mockImplementation(() => ({
    runCycle: vi.fn().mockResolvedValue({ cycle: 1, scoreBefore: 800, scoreAfter: 805, gain: 5, improvements: [], status: 'improved' }),
  })),
}));

const mockAgentRun = vi.fn().mockResolvedValue({
  output: 'AI safety research summary...',
  session: { totalInputTokens: 100, totalOutputTokens: 200, iterations: 2, toolCallCount: 0, sessionId: 's1', latencyMs: 1000 },
});

vi.mock('../agent.js', () => ({
  TrustNativeAgent: vi.fn().mockImplementation(() => ({ run: mockAgentRun })),
}));

function mockDealObj() {
  return {
    id: 'deal-1',
    title: 'Research task',
    description: 'Summarize AI safety',
    amountUsdc: 25,
    buyerAgentId: 'buyer-agent',
    listingId: 'listing-1',
    status: 'proposed',
  };
}

// ── Import after mocks are set up ─────────────────────────────────────────────
import { AutonomousEarningAgent } from './index.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AutonomousEarningAgent', () => {
  let agent: AutonomousEarningAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    mockJuryVerify.mockResolvedValue({ judgmentId: 'jury-1', verdict: 'pass', verdicts: [], passed: true, failedCriteria: [], confidence: 0.9, rawResponse: {} });
    mockMarketplace.listDeals.mockResolvedValue({ deals: [mockDealObj()] });
    mockMarketplace.createListing.mockResolvedValue({ id: 'listing-new' });
    mockEscrow.create.mockResolvedValue({ id: 'escrow-1', amountUsdc: 25 });
    mockCortex.recall.mockResolvedValue({ value: null });
    mockCortex.remember.mockResolvedValue({});

    agent = new AutonomousEarningAgent({
      apiKey: 'test-key',
      agentId: 'test-agent',
      anthropicApiKey: 'anthropic-key',
      capabilities: ['research', 'writing'],
      minDealValueUsdc: 1,
    });
  });

  describe('registerSkills', () => {
    it('creates marketplace listings for each skill', async () => {
      const ids = await agent.registerSkills([
        { title: 'Research', description: 'In-depth research', priceUsdc: 20 },
        { title: 'Writing', description: 'Technical writing', priceUsdc: 15 },
      ]);
      expect(ids).toHaveLength(2);
      expect(mockMarketplace.createListing).toHaveBeenCalledTimes(2);
    });

    it('handles 409 conflict silently (already listed)', async () => {
      mockMarketplace.createListing.mockRejectedValueOnce(new Error('409 conflict'));
      await expect(agent.registerSkills([{ title: 'Research', description: 'test', priceUsdc: 10 }])).resolves.not.toThrow();
    });

    it('re-throws non-conflict errors', async () => {
      mockMarketplace.createListing.mockRejectedValueOnce(new Error('500 internal server error'));
      await expect(agent.registerSkills([{ title: 'R', description: 'D', priceUsdc: 1 }])).rejects.toThrow('500');
    });
  });

  describe('findBestDeal', () => {
    it('returns the highest-value eligible deal', async () => {
      const deal = await agent.findBestDeal();
      expect(deal).not.toBeNull();
      expect((deal as Record<string, unknown>)['id']).toBe('deal-1');
    });

    it('returns null when no deals exist', async () => {
      mockMarketplace.listDeals.mockResolvedValueOnce({ deals: [] });
      expect(await agent.findBestDeal()).toBeNull();
    });

    it('filters out deals below minDealValueUsdc', async () => {
      mockMarketplace.listDeals.mockResolvedValueOnce({ deals: [{ ...mockDealObj(), amountUsdc: 0.5 }] });
      const cheapAgent = new AutonomousEarningAgent({ apiKey: 'key', agentId: 'agent', capabilities: [], minDealValueUsdc: 5 });
      expect(await cheapAgent.findBestDeal()).toBeNull();
    });

    it('returns null on API error', async () => {
      mockMarketplace.listDeals.mockRejectedValueOnce(new Error('network error'));
      expect(await agent.findBestDeal()).toBeNull();
    });

    it('returns highest-value when multiple deals exist', async () => {
      mockMarketplace.listDeals.mockResolvedValueOnce({
        deals: [
          { ...mockDealObj(), id: 'deal-low', amountUsdc: 5 },
          { ...mockDealObj(), id: 'deal-high', amountUsdc: 50 },
          { ...mockDealObj(), id: 'deal-mid', amountUsdc: 20 },
        ],
      });
      const deal = await agent.findBestDeal();
      expect((deal as Record<string, unknown>)['id']).toBe('deal-high');
    });
  });

  describe('acceptDeal', () => {
    it('creates escrow and returns ActiveDeal', async () => {
      const active = await agent.acceptDeal(mockDealObj() as never);
      expect(active.escrow).toBeDefined();
      expect((active.escrow as Record<string, unknown>)['id']).toBe('escrow-1');
      expect(active.acceptedAt).toBeTruthy();
    });

    it('proceeds without escrow if creation fails', async () => {
      mockEscrow.create.mockRejectedValueOnce(new Error('escrow unavailable'));
      const active = await agent.acceptDeal(mockDealObj() as never);
      expect(active.escrow).toBeUndefined();
    });

    it('persists deal acceptance to Cortex', async () => {
      await agent.acceptDeal(mockDealObj() as never);
      expect(mockCortex.remember).toHaveBeenCalled();
    });
  });

  describe('deliverWithJuryGate', () => {
    it('delivers and releases escrow when jury passes', async () => {
      const active = await agent.acceptDeal(mockDealObj() as never);
      const output = { content: 'Research done', tokensUsed: 300, latencyMs: 2000, iterations: 2 };
      const result = await agent.deliverWithJuryGate(active, output);
      expect(result.verdict).toBe('delivered');
      expect(result.earnedUsdc).toBe(25);
      expect(result.revisionsUsed).toBe(0);
    });

    it('abandons after maxRevisions jury rejections', async () => {
      mockJuryVerify.mockResolvedValue({ judgmentId: 'j', verdict: 'fail', verdicts: [], passed: false, failedCriteria: ['accuracy'], confidence: 0.6, rawResponse: {} });

      const limitedAgent = new AutonomousEarningAgent({
        apiKey: 'key', agentId: 'agent', anthropicApiKey: 'key',
        capabilities: [], maxRevisions: 2,
      });

      const active = await limitedAgent.acceptDeal(mockDealObj() as never);
      const output = { content: 'bad output', tokensUsed: 100, latencyMs: 500, iterations: 1 };
      const result = await limitedAgent.deliverWithJuryGate(active, output);

      expect(result.verdict).toBe('abandoned');
      expect(result.revisionsUsed).toBeGreaterThan(0);
    });

    it('delivers without jury when jury API is unavailable', async () => {
      mockJuryVerify.mockRejectedValueOnce(new Error('jury unavailable'));
      const active = await agent.acceptDeal(mockDealObj() as never);
      const output = { content: 'output', tokensUsed: 100, latencyMs: 500, iterations: 1 };
      const result = await agent.deliverWithJuryGate(active, output);
      expect(result.verdict).toBe('delivered');
    });
  });

  describe('getLifetimeEarnings', () => {
    it('returns zero-state when no records exist', async () => {
      const report = await agent.getLifetimeEarnings();
      expect(report.totalDeals).toBe(0);
      expect(report.totalUsdc).toBe(0);
    });

    it('parses earnings from Cortex memory', async () => {
      const records = [
        { dealId: 'd1', title: 'Deal 1', earnedUsdc: 25, verdict: 'delivered', completedAt: '2026-06-01T00:00:00Z', skill: 'research' },
        { dealId: 'd2', title: 'Deal 2', earnedUsdc: 0, verdict: 'abandoned', completedAt: '2026-06-02T00:00:00Z' },
      ];
      mockCortex.recall.mockResolvedValueOnce({ value: JSON.stringify(records) });

      const report = await agent.getLifetimeEarnings();
      expect(report.totalDeals).toBe(2);
      expect(report.successfulDeals).toBe(1);
      expect(report.abandonedDeals).toBe(1);
      expect(report.totalUsdc).toBe(25);
      expect(report.topSkill).toBe('research');
    });
  });
});

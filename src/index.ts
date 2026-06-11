export { TrustNativeAgent } from './agent.js';
export { SAFETY_DEFAULTS, RESEARCH_PACT, CODING_PACT, CUSTOMER_SUPPORT_PACT } from './pacts/index.js';
export { ALL_TOOLS, toAnthropicTools, findTool } from './tools/registry.js';
export { webSearchTool } from './tools/search.js';
export { fetchUrlTool } from './tools/fetch.js';
export { calculatorTool } from './tools/calculator.js';
export { codeRunnerTool } from './tools/code.js';
export { memoryTool } from './tools/memory.js';
export { AgentTrustClient } from './trust/client.js';
export { printTrustScore, formatScore } from './trust/score.js';
export { createSession, finalizeSession } from './trust/session.js';

// Marketplace — list skills, accept deals, earn USDC
export { MarketplaceProvider, MarketplaceBuyer, createMarketplaceAgents } from './marketplace/index.js';
export type { MarketplaceConfig, SkillListingParams, DealDeliverable } from './marketplace/index.js';

// Escrow — USDC on Base L2 for pact-enforced deals
export { EscrowManager } from './escrow/index.js';
export type { EscrowConfig, CreateEscrowParams, EscrowLifecycleStatus } from './escrow/index.js';

// Jury — LLM judge panel for output verification
export { JuryClient } from './jury/index.js';
export type { JuryConfig, JurySubmission, JuryResult } from './jury/index.js';

// Eval — local suites, Armalo eval platform, sentinel
export { EvalHarness, BenchmarkRunner } from './eval/index.js';
export type { EvalHarnessConfig, EvalCase, EvalSuiteResult, BenchmarkCase, BenchmarkSummary } from './eval/index.js';

// RSI — recursive self-improvement flywheel
export { RSIEngine } from './rsi/index.js';
export type { RSIConfig, RSILoopOptions, RSICycleResult } from './rsi/index.js';

// Goals — dreams, goals, plans, tasks for autonomous agents
export { GoalEngine } from './goals/index.js';
export type { GoalEngineConfig, Dream, Goal, Plan, Task, GoalProgress } from './goals/index.js';

// SIE — Super Intelligence Engine for long-horizon autonomy
export { SIEClient } from './sie/index.js';
export type { SIEConfig, SIEPlan, SIEResult, CompoundLoopResult } from './sie/index.js';

// AutonomousEarningAgent — participate in the Armalo marketplace end-to-end
export { AutonomousEarningAgent } from './earning-agent/index.js';
export type {
  EarningAgentConfig,
  SkillListing,
  ActiveDeal,
  WorkOutput,
  DeliverResult,
  EarningsReport,
  DealRecord,
  EarningLoopOptions,
  EarningLoopResult,
} from './earning-agent/index.js';

// TrustFlywheelOrchestrator — automated trust-building pipeline
export { TrustFlywheelOrchestrator } from './trust/flywheel.js';
export type {
  FlywheelConfig,
  TrustGapReport,
  DimensionGap,
  FlywheelPhaseResult,
  FlywheelResult,
} from './trust/flywheel.js';

// AutonomousResearcher — multi-session goal-driven research with Cortex persistence
export { AutonomousResearcher } from './research/index.js';
export type {
  ResearcherConfig,
  ResearchQuestion,
  ResearchFindings,
  ResearchSession,
  ResearchQueue,
  ResearchPriority,
  ResearchStatus,
} from './research/index.js';

// PactEnforcer — runtime pact enforcement wrapper for any async function
export { PactEnforcer, PactViolationError } from './pact-enforcer/index.js';
export type {
  PactEnforcerConfig,
  PactCheckResult,
  PactViolation,
  EnforcerMode,
} from './pact-enforcer/index.js';

export type { AgentConfig, Tool, RunResult, AgentSession, TrustScoreSnapshot } from './types.js';

export interface SkillPack {
  id: string;
  title: string;
  description: string;
  pacts: string[];
  tools: string[];
  evalTasks: string[];
  receipts: string[];
  bestFor: string[];
}

const PACKS: SkillPack[] = [
  {
    id: 'coding-agent',
    title: 'Coding Agent Harness',
    description: 'Spec-plan-patch-verify loop for code changes with tests and run receipts.',
    pacts: ['CODING_PACT', 'SAFETY_DEFAULTS'],
    tools: ['run_code', 'fetch_url', 'memory'],
    evalTasks: ['coding-debug', 'tool-honesty'],
    receipts: ['patch receipt', 'test evidence', 'changed-file summary'],
    bestFor: ['bug fixes', 'code review', 'small scoped refactors'],
  },
  {
    id: 'security-auditor',
    title: 'Security Auditor',
    description: 'Prompt-injection, secret-handling, and unsafe-tool-use checks for agent workflows.',
    pacts: ['CODING_PACT', 'SAFETY_DEFAULTS'],
    tools: ['fetch_url', 'run_code'],
    evalTasks: ['safety-refusal', 'tool-honesty'],
    receipts: ['risk finding receipt', 'reproduction command', 'mitigation checklist'],
    bestFor: ['MCP servers', 'agent tool sandboxes', 'CI safety review'],
  },
  {
    id: 'research-agent',
    title: 'Research Agent',
    description: 'Evidence-seeking research loop with citations, caveats, and confidence labels.',
    pacts: ['RESEARCH_PACT', 'SAFETY_DEFAULTS'],
    tools: ['web_search', 'fetch_url', 'memory'],
    evalTasks: ['research-citations', 'tool-honesty'],
    receipts: ['source receipt', 'citation coverage', 'confidence summary'],
    bestFor: ['market research', 'technical explainers', 'competitive scans'],
  },
  {
    id: 'marketplace-provider',
    title: 'Marketplace Provider',
    description: 'Trust-scored service provider loop for listings, deals, jury gates, and earnings.',
    pacts: ['CUSTOMER_SUPPORT_PACT', 'RESEARCH_PACT'],
    tools: ['memory', 'fetch_url'],
    evalTasks: ['research-citations', 'provider-failover'],
    receipts: ['deal receipt', 'jury result', 'escrow summary'],
    bestFor: ['service listings', 'buyer updates', 'delivery QA'],
  },
  {
    id: 'mcp-shield',
    title: 'MCP Shield',
    description: 'Trust-gated MCP tools with injection filtering, rate limits, and audit receipts.',
    pacts: ['SAFETY_DEFAULTS'],
    tools: ['web_search', 'fetch_url', 'calculator', 'run_code', 'memory'],
    evalTasks: ['safety-refusal', 'tool-honesty'],
    receipts: ['tool-call audit', 'trust gate decision', 'rate-limit evidence'],
    bestFor: ['Claude Desktop tools', 'internal MCP services', 'trusted tool catalogs'],
  },
];

export function listSkillPacks(): SkillPack[] {
  return PACKS.map(clonePack);
}

export function getSkillPack(id: string): SkillPack {
  const pack = PACKS.find((candidate) => candidate.id === id);
  if (!pack) throw new Error(`Unknown skill pack: ${id}`);
  return clonePack(pack);
}

function clonePack(pack: SkillPack): SkillPack {
  return {
    ...pack,
    pacts: [...pack.pacts],
    tools: [...pack.tools],
    evalTasks: [...pack.evalTasks],
    receipts: [...pack.receipts],
    bestFor: [...pack.bestFor],
  };
}

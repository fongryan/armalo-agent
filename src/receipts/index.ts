import { createHash } from 'crypto';

export type ReceiptStatus = 'passed' | 'failed' | 'skipped';
export type VerificationStatus = 'verified' | 'failed' | 'unverified';

export interface ReceiptProvider {
  name: string;
  model?: string;
  region?: string;
}

export interface ReceiptPact {
  name: string;
  version?: string;
}

export interface ReceiptToolCall {
  name: string;
  status: ReceiptStatus;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
}

export interface ReceiptEvidence {
  kind: 'test' | 'diff' | 'artifact' | 'browser' | 'eval' | 'command';
  label: string;
  status: ReceiptStatus;
  command?: string;
  path?: string;
  url?: string;
  summary?: string;
}

export interface ReceiptCost {
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
}

export interface ReceiptResult {
  status: ReceiptStatus;
  summary: string;
}

export interface ReceiptVerification {
  status: VerificationStatus;
  passedEvidence: number;
  failedEvidence: number;
  skippedEvidence: number;
  checkedAt: string;
}

export interface RunReceiptInput {
  agentId: string;
  title: string;
  prompt: string;
  provider?: ReceiptProvider;
  pacts?: ReceiptPact[];
  toolCalls?: ReceiptToolCall[];
  evidence?: ReceiptEvidence[];
  cost?: ReceiptCost;
  result: ReceiptResult;
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RunReceipt extends Required<Omit<RunReceiptInput, 'provider' | 'cost' | 'metadata'>> {
  schemaVersion: '1.0.0';
  id: string;
  provider?: ReceiptProvider;
  cost?: ReceiptCost;
  metadata?: Record<string, unknown>;
  durationMs: number;
  verification: ReceiptVerification;
}

export function createRunReceipt(input: RunReceiptInput): RunReceipt {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const completedAt = input.completedAt ?? new Date().toISOString();
  const evidence = input.evidence ?? [];
  const toolCalls = input.toolCalls ?? [];
  const pacts = input.pacts ?? [];
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));

  const receiptBase = {
    schemaVersion: '1.0.0' as const,
    agentId: input.agentId,
    title: input.title,
    prompt: input.prompt,
    provider: input.provider,
    pacts,
    toolCalls,
    evidence,
    cost: input.cost,
    result: input.result,
    startedAt,
    completedAt,
    durationMs,
    metadata: input.metadata,
  };

  const id = `rct_${hashStable(receiptBase).slice(0, 16)}`;
  const draft: RunReceipt = {
    ...receiptBase,
    id,
    verification: {
      status: 'unverified',
      passedEvidence: 0,
      failedEvidence: 0,
      skippedEvidence: 0,
      checkedAt: completedAt,
    },
  };

  return { ...draft, verification: verifyReceipt(draft) };
}

export function verifyReceipt(receipt: Pick<RunReceipt, 'evidence' | 'result'>): ReceiptVerification {
  const passedEvidence = receipt.evidence.filter((e) => e.status === 'passed').length;
  const failedEvidence = receipt.evidence.filter((e) => e.status === 'failed').length;
  const skippedEvidence = receipt.evidence.filter((e) => e.status === 'skipped').length;
  const checkedAt = new Date().toISOString();

  let status: VerificationStatus = 'unverified';
  if (receipt.evidence.length === 0) {
    status = 'unverified';
  } else if (failedEvidence > 0 || receipt.result.status === 'failed') {
    status = 'failed';
  } else if (passedEvidence > 0 && receipt.result.status === 'passed') {
    status = 'verified';
  }

  return { status, passedEvidence, failedEvidence, skippedEvidence, checkedAt };
}

export function renderReceiptMarkdown(receipt: RunReceipt): string {
  const lines = [
    `# ${receipt.title}`,
    '',
    `Receipt: \`${receipt.id}\``,
    `Agent: \`${receipt.agentId}\``,
    `Result: ${receipt.result.status}`,
    `Verification: ${receipt.verification.status}`,
    `Duration: ${receipt.durationMs}ms`,
  ];

  if (receipt.provider) {
    lines.push(`Provider: ${receipt.provider.name}${receipt.provider.model ? ` / ${receipt.provider.model}` : ''}`);
  }

  lines.push('', '## Summary', '', receipt.result.summary, '', '## Evidence');

  if (receipt.evidence.length === 0) {
    lines.push('', '- No evidence attached.');
  } else {
    for (const item of receipt.evidence) {
      const detail = item.command ?? item.path ?? item.url ?? item.summary ?? '';
      lines.push(`- [${item.status}] ${item.kind}: ${item.label}${detail ? ` (${detail})` : ''}`);
    }
  }

  if (receipt.toolCalls.length > 0) {
    lines.push('', '## Tool Calls');
    for (const tool of receipt.toolCalls) {
      lines.push(`- [${tool.status}] ${tool.name}${tool.durationMs !== undefined ? ` (${tool.durationMs}ms)` : ''}`);
    }
  }

  return lines.join('\n');
}

export function renderReceiptHtml(receipt: RunReceipt): string {
  const evidence = receipt.evidence.map((item) => (
    `<li><strong>${escapeHtml(item.status)}</strong> ${escapeHtml(item.kind)}: ${escapeHtml(item.label)}</li>`
  )).join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>',
    escapeHtml(receipt.title),
    '</title></head>',
    '<body>',
    `<main><h1>${escapeHtml(receipt.title)}</h1>`,
    `<p><strong>Receipt:</strong> ${escapeHtml(receipt.id)}</p>`,
    `<p><strong>Verification:</strong> ${escapeHtml(receipt.verification.status)}</p>`,
    `<p>${escapeHtml(receipt.result.summary)}</p>`,
    `<h2>Evidence</h2><ul>${evidence || '<li>No evidence attached.</li>'}</ul>`,
    '</main>',
    '</body></html>',
  ].join('');
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  );
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

import { describe, expect, it } from 'vitest';
import {
  createRunReceipt,
  renderReceiptMarkdown,
  renderReceiptHtml,
  verifyReceipt,
} from './index.js';

describe('run receipts', () => {
  it('creates a deterministic receipt with summary evidence and verification status', () => {
    const receipt = createRunReceipt({
      agentId: 'coding-agent',
      title: 'Fix calculator bug',
      prompt: 'Make add() handle strings safely',
      provider: { name: 'openai', model: 'gpt-4.1' },
      pacts: [{ name: 'Coding Pact', version: '1.0.0' }],
      toolCalls: [{ name: 'run_tests', status: 'passed', durationMs: 412 }],
      evidence: [
        { kind: 'test', label: 'unit tests', status: 'passed', command: 'npm test' },
        { kind: 'diff', label: 'patch', status: 'passed', path: 'src/calculator.ts' },
      ],
      cost: { inputTokens: 10, outputTokens: 20, usd: 0.01 },
      result: { status: 'passed', summary: 'Patched and verified.' },
      startedAt: '2026-06-12T00:00:00.000Z',
      completedAt: '2026-06-12T00:00:01.250Z',
    });

    expect(receipt.id).toMatch(/^rct_/);
    expect(receipt.schemaVersion).toBe('1.0.0');
    expect(receipt.durationMs).toBe(1250);
    expect(receipt.verification.status).toBe('verified');
    expect(receipt.verification.passedEvidence).toBe(2);
    expect(receipt.verification.failedEvidence).toBe(0);
  });

  it('renders markdown and html that are safe to publish', () => {
    const receipt = createRunReceipt({
      agentId: 'agent-1',
      title: 'Research task',
      prompt: 'Find citations',
      evidence: [{ kind: 'artifact', label: 'report', status: 'passed', url: 'https://example.com/report' }],
      result: { status: 'passed', summary: 'Report ready.' },
      startedAt: '2026-06-12T00:00:00.000Z',
      completedAt: '2026-06-12T00:00:00.100Z',
    });

    const markdown = renderReceiptMarkdown(receipt);
    const html = renderReceiptHtml(receipt);

    expect(markdown).toContain('# Research task');
    expect(markdown).toContain('Verification: verified');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Research task');
    expect(html).not.toContain('<script>');
  });

  it('marks receipts as unverified when required proof fails or is missing', () => {
    const receipt = createRunReceipt({
      agentId: 'agent-1',
      title: 'Unproven run',
      prompt: 'Do work',
      evidence: [{ kind: 'test', label: 'unit tests', status: 'failed', command: 'npm test' }],
      result: { status: 'failed', summary: 'Tests failed.' },
      startedAt: '2026-06-12T00:00:00.000Z',
      completedAt: '2026-06-12T00:00:00.100Z',
    });

    expect(verifyReceipt(receipt).status).toBe('failed');
    expect(verifyReceipt({ ...receipt, evidence: [] }).status).toBe('unverified');
  });
});

import { createRunReceipt, type RunReceipt } from '../receipts/index.js';

export interface CodingHarnessRequest {
  title: string;
  prompt: string;
  repoPath: string;
}

export interface CodingPlan {
  summary: string;
  steps: string[];
}

export interface CodingPatch {
  summary: string;
  filesChanged: string[];
  diff: string;
}

export interface VerificationRun {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CodingHarnessConfig {
  agentId: string;
  planner: (request: CodingHarnessRequest) => Promise<CodingPlan>;
  patcher: (request: CodingHarnessRequest, plan: CodingPlan) => Promise<CodingPatch>;
  verifier: (request: CodingHarnessRequest, patch: CodingPatch) => Promise<VerificationRun[]>;
}

export interface CodingHarnessResult {
  status: 'passed' | 'failed';
  request: CodingHarnessRequest;
  plan: CodingPlan;
  patch: CodingPatch;
  verification: VerificationRun[];
  receipt: RunReceipt;
}

export class CodingHarness {
  constructor(private readonly config: CodingHarnessConfig) {}

  async run(request: CodingHarnessRequest): Promise<CodingHarnessResult> {
    const startedAt = new Date().toISOString();
    const plan = await this.config.planner(request);
    const patch = await this.config.patcher(request, plan);
    const verification = await this.config.verifier(request, patch);
    const passed = verification.length > 0 && verification.every((run) => run.exitCode === 0);
    const completedAt = new Date().toISOString();

    const receipt = createRunReceipt({
      agentId: this.config.agentId,
      title: request.title,
      prompt: request.prompt,
      toolCalls: [
        { name: 'planner', status: 'passed', outputSummary: plan.summary },
        { name: 'patcher', status: 'passed', outputSummary: patch.summary },
        { name: 'verifier', status: passed ? 'passed' : 'failed' },
      ],
      evidence: [
        ...verification.map((run) => ({
          kind: 'test' as const,
          label: run.command,
          status: run.exitCode === 0 ? 'passed' as const : 'failed' as const,
          command: run.command,
          summary: run.exitCode === 0 ? run.stdout : run.stderr,
        })),
        ...patch.filesChanged.map((path) => ({
          kind: 'diff' as const,
          label: `Changed ${path}`,
          status: 'passed' as const,
          path,
          summary: patch.summary,
        })),
      ],
      result: {
        status: passed ? 'passed' : 'failed',
        summary: passed
          ? `Applied patch and verified ${verification.length} command(s).`
          : 'Patch failed verification and should not be trusted yet.',
      },
      startedAt,
      completedAt,
      metadata: {
        repoPath: request.repoPath,
        planSteps: plan.steps,
        diff: patch.diff,
      },
    });

    return {
      status: passed ? 'passed' : 'failed',
      request,
      plan,
      patch,
      verification,
      receipt,
    };
  }
}

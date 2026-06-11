import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Code runner — executes JavaScript/TypeScript snippets in an isolated subprocess.
 * Limited to 15 seconds, stdout/stderr capped at 10KB.
 *
 * For production use, replace this with @armalo/agent-ops or a sandboxed executor.
 */
export const codeRunnerTool: Tool = {
  name: 'run_code',
  description: 'Execute a JavaScript or TypeScript code snippet and return its output. Useful for calculations, data transformation, and algorithm prototyping.',
  input_schema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['javascript', 'typescript'],
        description: 'The programming language (javascript or typescript)',
      },
      code: {
        type: 'string',
        description: 'The code to execute. Use console.log() to output results.',
      },
    },
    required: ['language', 'code'],
  },
  async execute({ language, code }: Record<string, unknown>) {
    const lang = String(language).toLowerCase();
    const src = String(code);

    if (!['javascript', 'typescript'].includes(lang)) {
      throw new Error(`Unsupported language: ${lang}. Only javascript and typescript are supported.`);
    }

    const dir = await mkdtemp(join(tmpdir(), 'armalo-agent-'));
    const ext = lang === 'typescript' ? 'ts' : 'mjs';
    const file = join(dir, `snippet.${ext}`);

    try {
      await writeFile(file, src, 'utf-8');

      const cmd = lang === 'typescript'
        ? `npx --yes tsx "${file}"`
        : `node "${file}"`;

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
          // Strip sensitive vars from subprocess
          ANTHROPIC_API_KEY: undefined,
          ARMALO_API_KEY: undefined,
          OPENAI_API_KEY: undefined,
        },
      });

      return {
        stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
        stderr: stderr.slice(0, MAX_OUTPUT_LENGTH),
        truncated: stdout.length > MAX_OUTPUT_LENGTH || stderr.length > MAX_OUTPUT_LENGTH,
        exitCode: 0,
      };
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
        return {
          stdout: (execErr.stdout ?? '').slice(0, MAX_OUTPUT_LENGTH),
          stderr: (execErr.stderr ?? err.message).slice(0, MAX_OUTPUT_LENGTH),
          truncated: false,
          exitCode: execErr.killed ? 124 : 1,
          error: execErr.killed ? 'Execution timed out' : err.message,
        };
      }
      throw err;
    } finally {
      await unlink(file).catch(() => undefined);
    }
  },
};

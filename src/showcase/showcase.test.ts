import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('public showcase', () => {
  it('runs without paid provider keys and prints the OSS proof surfaces', () => {
    const output = execFileSync('npm', ['run', 'example:showcase'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    });

    expect(output).toContain('ARMALO AGENT PUBLIC SHOWCASE');
    expect(output).toContain('Provider router selected: demo-local-provider after 2 attempts');
    expect(output).toContain('Coding harness status: passed');
    expect(output).toContain('Verification: verified');
    expect(output).toContain('Gauntlet score: 1000/1000');
    expect(output).toContain('Skill packs:');
  });
});

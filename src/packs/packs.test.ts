import { describe, expect, it } from 'vitest';
import { getSkillPack, listSkillPacks } from './index.js';

describe('skill packs', () => {
  it('ships a curated public catalog of serious agent packs', () => {
    const packs = listSkillPacks();

    expect(packs.map((p) => p.id)).toEqual(expect.arrayContaining([
      'coding-agent',
      'security-auditor',
      'research-agent',
      'marketplace-provider',
      'mcp-shield',
    ]));
    expect(packs.every((p) => p.pacts.length > 0 && p.tools.length > 0 && p.evalTasks.length > 0)).toBe(true);
  });

  it('returns immutable copies so callers cannot mutate the catalog', () => {
    const pack = getSkillPack('coding-agent');
    pack.tools.push('mutated');

    expect(getSkillPack('coding-agent').tools).not.toContain('mutated');
  });
});

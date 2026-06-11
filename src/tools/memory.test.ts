import { describe, it, expect, beforeEach } from 'vitest';
import { memoryTool } from './memory.js';

type WriteResult = { stored: boolean; key: string };
type ReadResult = { found: boolean; key: string; value?: unknown; importance?: string; storedAt?: string };
type ListResult = { keys: string[]; count: number; entries: Array<{ key: string; importance: string; storedAt: string }> };
type DeleteResult = { deleted: boolean; key: string };

// Clear the module-level sessionMemory Map before each test
async function clearAll(): Promise<void> {
  const { keys } = await memoryTool.execute({ action: 'list' }) as ListResult;
  for (const key of keys) {
    await memoryTool.execute({ action: 'delete', key });
  }
}

describe('memoryTool — write', () => {
  beforeEach(clearAll);

  it('stores a string value and returns stored:true', async () => {
    const result = await memoryTool.execute({ action: 'write', key: 'name', value: 'Alice' }) as WriteResult;
    expect(result.stored).toBe(true);
    expect(result.key).toBe('name');
  });

  it('stores a number value', async () => {
    await memoryTool.execute({ action: 'write', key: 'count', value: 42 });
    const result = await memoryTool.execute({ action: 'read', key: 'count' }) as ReadResult;
    expect(result.value).toBe(42);
  });

  it('stores a nested object value', async () => {
    const obj = { tags: ['a', 'b'], meta: { n: 1 } };
    await memoryTool.execute({ action: 'write', key: 'obj', value: obj });
    const result = await memoryTool.execute({ action: 'read', key: 'obj' }) as ReadResult;
    expect(result.value).toEqual(obj);
  });

  it('stores a null value', async () => {
    await memoryTool.execute({ action: 'write', key: 'nul', value: null });
    const result = await memoryTool.execute({ action: 'read', key: 'nul' }) as ReadResult;
    expect(result.found).toBe(true);
    expect(result.value).toBeNull();
  });

  it('overwrites an existing key', async () => {
    await memoryTool.execute({ action: 'write', key: 'x', value: 'first' });
    await memoryTool.execute({ action: 'write', key: 'x', value: 'second' });
    const result = await memoryTool.execute({ action: 'read', key: 'x' }) as ReadResult;
    expect(result.value).toBe('second');
  });

  it('stores high importance level', async () => {
    await memoryTool.execute({ action: 'write', key: 'critical', value: 'data', importance: 'high' });
    const result = await memoryTool.execute({ action: 'read', key: 'critical' }) as ReadResult;
    expect(result.importance).toBe('high');
  });

  it('stores low importance level', async () => {
    await memoryTool.execute({ action: 'write', key: 'trivial', value: 'data', importance: 'low' });
    const result = await memoryTool.execute({ action: 'read', key: 'trivial' }) as ReadResult;
    expect(result.importance).toBe('low');
  });

  it('defaults importance to medium when omitted', async () => {
    await memoryTool.execute({ action: 'write', key: 'default', value: 'test' });
    const result = await memoryTool.execute({ action: 'read', key: 'default' }) as ReadResult;
    expect(result.importance).toBe('medium');
  });

  it('records storedAt timestamp as ISO string', async () => {
    const before = new Date().toISOString();
    await memoryTool.execute({ action: 'write', key: 'ts', value: 'v' });
    const result = await memoryTool.execute({ action: 'read', key: 'ts' }) as ReadResult;
    expect(result.storedAt).toBeDefined();
    expect(new Date(result.storedAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('throws when key is missing on write', async () => {
    await expect(memoryTool.execute({ action: 'write', value: 'data' })).rejects.toThrow('key is required');
  });
});

describe('memoryTool — read', () => {
  beforeEach(clearAll);

  it('returns found:false for a missing key', async () => {
    const result = await memoryTool.execute({ action: 'read', key: 'ghost' }) as ReadResult;
    expect(result.found).toBe(false);
    expect(result.key).toBe('ghost');
  });

  it('returns found:true and the value for an existing key', async () => {
    await memoryTool.execute({ action: 'write', key: 'greeting', value: 'hello' });
    const result = await memoryTool.execute({ action: 'read', key: 'greeting' }) as ReadResult;
    expect(result.found).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('returns the entry key in the response', async () => {
    await memoryTool.execute({ action: 'write', key: 'mykey', value: 1 });
    const result = await memoryTool.execute({ action: 'read', key: 'mykey' }) as ReadResult;
    expect(result.key).toBe('mykey');
  });

  it('throws when key is missing on read', async () => {
    await expect(memoryTool.execute({ action: 'read' })).rejects.toThrow('key is required');
  });
});

describe('memoryTool — list', () => {
  beforeEach(clearAll);

  it('returns empty list when no entries exist', async () => {
    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    expect(result.count).toBe(0);
    expect(result.keys).toHaveLength(0);
    expect(result.entries).toHaveLength(0);
  });

  it('returns all stored keys', async () => {
    await memoryTool.execute({ action: 'write', key: 'a', value: 1 });
    await memoryTool.execute({ action: 'write', key: 'b', value: 2 });
    await memoryTool.execute({ action: 'write', key: 'c', value: 3 });

    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    expect(result.count).toBe(3);
    expect(result.keys).toContain('a');
    expect(result.keys).toContain('b');
    expect(result.keys).toContain('c');
  });

  it('count matches keys array length', async () => {
    await memoryTool.execute({ action: 'write', key: 'x1', value: 1 });
    await memoryTool.execute({ action: 'write', key: 'x2', value: 2 });

    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    expect(result.count).toBe(result.keys.length);
    expect(result.count).toBe(result.entries.length);
  });

  it('includes importance in entry metadata', async () => {
    await memoryTool.execute({ action: 'write', key: 'meta', value: 'v', importance: 'high' });

    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    const entry = result.entries.find((e) => e.key === 'meta');
    expect(entry?.importance).toBe('high');
  });

  it('includes storedAt in entry metadata', async () => {
    await memoryTool.execute({ action: 'write', key: 'ts-entry', value: 'v' });

    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    const entry = result.entries.find((e) => e.key === 'ts-entry');
    expect(entry?.storedAt).toBeDefined();
    expect(new Date(entry!.storedAt).toString()).not.toBe('Invalid Date');
  });

  it('does not include value in list metadata', async () => {
    await memoryTool.execute({ action: 'write', key: 'secret', value: 'sensitive-data' });

    const result = await memoryTool.execute({ action: 'list' }) as ListResult;
    const entry = result.entries.find((e) => e.key === 'secret');
    expect(JSON.stringify(entry)).not.toContain('sensitive-data');
  });
});

describe('memoryTool — delete', () => {
  beforeEach(clearAll);

  it('deletes an existing key and returns deleted:true', async () => {
    await memoryTool.execute({ action: 'write', key: 'del', value: 'bye' });
    const result = await memoryTool.execute({ action: 'delete', key: 'del' }) as DeleteResult;
    expect(result.deleted).toBe(true);
    expect(result.key).toBe('del');
  });

  it('key is no longer readable after deletion', async () => {
    await memoryTool.execute({ action: 'write', key: 'gone', value: 'bye' });
    await memoryTool.execute({ action: 'delete', key: 'gone' });

    const read = await memoryTool.execute({ action: 'read', key: 'gone' }) as ReadResult;
    expect(read.found).toBe(false);
  });

  it('key does not appear in list after deletion', async () => {
    await memoryTool.execute({ action: 'write', key: 'rem', value: 'x' });
    await memoryTool.execute({ action: 'delete', key: 'rem' });

    const list = await memoryTool.execute({ action: 'list' }) as ListResult;
    expect(list.keys).not.toContain('rem');
  });

  it('returns deleted:false for a nonexistent key', async () => {
    const result = await memoryTool.execute({ action: 'delete', key: 'ghost' }) as DeleteResult;
    expect(result.deleted).toBe(false);
    expect(result.key).toBe('ghost');
  });

  it('throws when key is missing on delete', async () => {
    await expect(memoryTool.execute({ action: 'delete' })).rejects.toThrow('key is required');
  });

  it('only deletes the targeted key, leaving others intact', async () => {
    await memoryTool.execute({ action: 'write', key: 'keep1', value: 1 });
    await memoryTool.execute({ action: 'write', key: 'keep2', value: 2 });
    await memoryTool.execute({ action: 'write', key: 'remove', value: 3 });

    await memoryTool.execute({ action: 'delete', key: 'remove' });

    const list = await memoryTool.execute({ action: 'list' }) as ListResult;
    expect(list.keys).toContain('keep1');
    expect(list.keys).toContain('keep2');
    expect(list.keys).not.toContain('remove');
  });
});

describe('memoryTool — error cases', () => {
  it('throws on an unknown action', async () => {
    await expect(memoryTool.execute({ action: 'flush' })).rejects.toThrow('Unknown memory action: flush');
  });
});

describe('memoryTool — tool metadata', () => {
  it('has the correct tool name', () => {
    expect(memoryTool.name).toBe('memory');
  });

  it('has a non-empty description', () => {
    expect(memoryTool.description.length).toBeGreaterThan(10);
  });

  it('input_schema requires action', () => {
    expect(memoryTool.input_schema.required).toContain('action');
  });

  it('action property has enum values', () => {
    const prop = memoryTool.input_schema.properties['action'] as { enum?: string[] };
    expect(prop?.enum).toContain('read');
    expect(prop?.enum).toContain('write');
    expect(prop?.enum).toContain('list');
    expect(prop?.enum).toContain('delete');
  });
});

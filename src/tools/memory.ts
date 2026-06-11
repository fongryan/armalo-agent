import type { Tool } from '../types.js';

interface MemoryEntry {
  key: string;
  value: unknown;
  storedAt: string;
  importance: 'low' | 'medium' | 'high';
}

// In-memory store for the current session.
// In production, wire this to @armalo/cortex or @armalo/core ArmaloClient.cortex API.
const sessionMemory = new Map<string, MemoryEntry>();

/**
 * Session memory tool — lets the agent store and retrieve facts across turns.
 *
 * In production, extend this to persist to Armalo Cortex:
 * https://armalo.ai/docs/sdk/cortex
 */
export const memoryTool: Tool = {
  name: 'memory',
  description: 'Store or retrieve facts across conversation turns. Use "write" to save information, "read" to recall it, and "list" to see all stored keys.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'list', 'delete'],
        description: 'The memory operation to perform',
      },
      key: {
        type: 'string',
        description: 'The memory key (required for read/write/delete)',
      },
      value: {
        description: 'The value to store (required for write)',
      },
      importance: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How important this memory is (affects retention in Armalo Cortex)',
      },
    },
    required: ['action'],
  },
  async execute({ action, key, value, importance = 'medium' }: Record<string, unknown>) {
    switch (String(action)) {
      case 'write': {
        if (!key) throw new Error('key is required for write');
        const entry: MemoryEntry = {
          key: String(key),
          value,
          storedAt: new Date().toISOString(),
          importance: (importance as MemoryEntry['importance']) ?? 'medium',
        };
        sessionMemory.set(String(key), entry);
        return { stored: true, key: String(key) };
      }
      case 'read': {
        if (!key) throw new Error('key is required for read');
        const entry = sessionMemory.get(String(key));
        if (!entry) return { found: false, key: String(key) };
        return { found: true, ...entry };
      }
      case 'list': {
        return {
          keys: Array.from(sessionMemory.keys()),
          count: sessionMemory.size,
          entries: Array.from(sessionMemory.values()).map((e) => ({
            key: e.key,
            importance: e.importance,
            storedAt: e.storedAt,
          })),
        };
      }
      case 'delete': {
        if (!key) throw new Error('key is required for delete');
        const existed = sessionMemory.delete(String(key));
        return { deleted: existed, key: String(key) };
      }
      default:
        throw new Error(`Unknown memory action: ${action}`);
    }
  },
};

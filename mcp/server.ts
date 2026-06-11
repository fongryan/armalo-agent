/**
 * MCP Server with Armalo Shield
 *
 * A Model Context Protocol server that exposes the agent's tools to any
 * MCP-compatible client (Claude Desktop, VS Code, etc.).
 *
 * Protected by @armalo/mcp-shield:
 * - Trust-score gating (block agents below threshold)
 * - Per-tool rate limiting
 * - Prompt injection pre-filtering
 * - Full audit trail sent to Armalo
 *
 * Run: npx tsx mcp/server.ts
 * Add to Claude Desktop: see mcp/README.md
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpShield } from '@armalo/mcp-shield';
import { ALL_TOOLS } from '../src/tools/registry.js';

// ── Configure the trust shield ────────────────────────────────────────────────

const shield = createMcpShield({
  // Armalo API key for trust-score lookups and audit forwarding
  armaloApiKey: process.env.ARMALO_API_KEY,
  armaloBaseUrl: process.env.ARMALO_BASE_URL,

  policy: {
    // Minimum trust score (0–1000) for ALL tools
    defaultMinTrustScore: parseInt(process.env.MCP_MIN_TRUST_SCORE ?? '0'),

    // Per-tool rate limits (calls per minute)
    defaultRateLimitPerMinute: parseInt(process.env.MCP_RATE_LIMIT ?? '60'),

    // Per-tool overrides
    perTool: {
      run_code: {
        // Code execution requires a higher trust score
        minTrustScore: 700,
        rateLimitPerMinute: 10,
      },
      web_search: {
        rateLimitPerMinute: 20,
      },
      fetch_url: {
        rateLimitPerMinute: 15,
      },
    },

    // Block known injection patterns
    enableInjectionFilter: true,
  },
});

// ── Build the MCP server ──────────────────────────────────────────────────────

const server = new Server(
  { name: 'armalo-agent', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: ALL_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  })),
}));

// Handle tool calls — each wrapped with the Armalo shield
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  // Find the tool
  const tool = ALL_TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  // Wrap with shield — applies trust gating, rate limiting, injection filter
  const shielded = shield.wrapTool(toolName, async (input: Record<string, unknown>) => {
    return await tool.execute(input);
  });

  try {
    const result = await shielded(args);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

const health = shield.healthcheck();
console.error(`[armalo-mcp] Server started`);
console.error(`[armalo-mcp] Tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}`);
console.error(`[armalo-mcp] Shield: ${health.configValid ? 'active' : 'config error'}`);
console.error(`[armalo-mcp] Trust gate: ${process.env.MCP_MIN_TRUST_SCORE ?? '0'} minimum score`);

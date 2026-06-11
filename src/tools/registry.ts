import { webSearchTool } from './search.js';
import { fetchUrlTool } from './fetch.js';
import { calculatorTool } from './calculator.js';
import { codeRunnerTool } from './code.js';
import { memoryTool } from './memory.js';
import type { Tool } from '../types.js';

export const ALL_TOOLS: Tool[] = [
  webSearchTool,
  fetchUrlTool,
  calculatorTool,
  codeRunnerTool,
  memoryTool,
];

export function toAnthropicTools(tools: Tool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function findTool(name: string, tools: Tool[] = ALL_TOOLS): Tool | undefined {
  return tools.find((t) => t.name === name);
}

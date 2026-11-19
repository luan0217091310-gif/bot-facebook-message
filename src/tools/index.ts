import type { ToolSchema } from '../core/llm.js';
import type { Tool, ToolContext } from './types.js';

export function visibleTools(all: Tool[], ctx: ToolContext): Tool[] {
  return all.filter((tool) => {
    if (tool.access === 'admin' && !ctx.isAdmin) return false;
    if (tool.dmOnly && ctx.isGroup) return false;
    return true;
  });
}

export function toToolSchemas(tools: Tool[]): ToolSchema[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

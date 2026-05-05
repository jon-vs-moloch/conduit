import { z } from 'zod';
import type { ToolAction, ToolResult } from '../protocol/schemas.js';

export interface ToolContext {
  projectRoot: string;
  runId: string;
  runDir: string;
}

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  schema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  run(args: TArgs, context: ToolContext): Promise<ToolResultContent>;
}

export interface ToolResultContent {
  content?: unknown;
  metadata?: Record<string, unknown>;
}

export async function executeToolAction(
  action: ToolAction,
  tool: ToolDefinition,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const args = tool.schema.parse(action.args);
    const result = await tool.run(args, context);
    return {
      id: action.id,
      tool: action.tool,
      status: 'ok',
      content: result.content,
      metadata: result.metadata
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('outside project root') || message.includes('sensitive')
      ? 'denied'
      : 'error';
    return {
      id: action.id,
      tool: action.tool,
      status,
      error: message
    };
  }
}

import { z } from 'zod';

export const ToolActionSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()),
  reason: z.string().optional(),
  risk: z.enum(['low', 'medium', 'high']).optional()
});

export const ActionRequestBlockSchema = z.object({
  schema: z.literal('conduit.request.v1').optional(),
  type: z.union([
    z.literal('actions'),
    z.literal('conduit.request.v1')
  ]).optional(),
  source: z.object({
    kind: z.string().min(1),
    trust: z.string().min(1).optional()
  }).passthrough().optional(),
  permissions: z.array(z.unknown()).optional(),
  sessionId: z.string().optional(),
  nonce: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  requestedCapabilities: z.array(z.string()).optional(),
  actions: z.array(ToolActionSchema).min(1),
  resultMode: z.object({
    transport: z.enum(['clipboard', 'app', 'file', 'extension', 'none']),
    format: z.enum(['json', 'markdown', 'text']).optional()
  }).optional()
}).superRefine((block, ctx) => {
  const seen = new Set<string>();
  for (const action of block.actions) {
    if (seen.has(action.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate action id: ${action.id}`,
        path: ['actions']
      });
    }
    seen.add(action.id);
  }
});

export const ToolResultSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  status: z.enum(['ok', 'error', 'denied', 'requires_confirmation']),
  content: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const ToolResultsBlockSchema = z.object({
  results: z.array(ToolResultSchema)
});

export const ArtifactRefSchema = z.object({
  type: z.enum(['file', 'patch', 'log', 'url', 'note']),
  path: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional()
});

export const FinalBlockSchema = z.object({
  status: z.enum(['complete', 'blocked', 'needs_user', 'failed']),
  summary: z.string().min(1),
  nextActions: z.array(z.string()).optional(),
  artifacts: z.array(ArtifactRefSchema).optional(),
  risks: z.array(z.string()).optional()
});

export type ToolAction = z.infer<typeof ToolActionSchema>;
export type ActionRequestBlock = z.infer<typeof ActionRequestBlockSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ToolResultsBlock = z.infer<typeof ToolResultsBlockSchema>;
export type FinalBlock = z.infer<typeof FinalBlockSchema>;

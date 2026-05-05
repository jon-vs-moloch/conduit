import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isSensitivePath } from '../policy/sensitive-paths.js';
import { resolveInsideProject } from '../policy/sandbox.js';
import type { ToolDefinition } from './types.js';

const FileReadArgsSchema = z.object({
  path: z.string().min(1),
  maxChars: z.number().int().positive().max(100_000).optional(),
  offset: z.number().int().nonnegative().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
}).refine((args) => {
  if (args.startLine === undefined || args.endLine === undefined) return true;
  return args.endLine >= args.startLine;
}, 'endLine must be greater than or equal to startLine');

type FileReadArgs = z.infer<typeof FileReadArgsSchema>;

export const fileReadTool: ToolDefinition<FileReadArgs> = {
  name: 'file.read',
  description: 'Read a UTF-8 text file inside the project sandbox.',
  risk: 'low',
  schema: FileReadArgsSchema,
  async run(args, context) {
    const projectRoot = await realpath(context.projectRoot);
    const absolutePath = await resolveInsideProject(args.path, context.projectRoot);
    if (isSensitivePath(absolutePath)) {
      throw new Error(`Denied sensitive file read: ${args.path}`);
    }

    const rawContent = await readFile(absolutePath, 'utf8');
    const selectedContent = selectLineRange(rawContent, args.startLine, args.endLine);
    const maxChars = args.maxChars ?? 20_000;
    const offset = args.offset ?? 0;
    const content = selectedContent.slice(offset, offset + maxChars);
    const nextOffset = offset + content.length < selectedContent.length
      ? offset + content.length
      : undefined;
    const truncated = nextOffset !== undefined;

    return {
      content,
      metadata: {
        absolutePath,
        relativePath: path.relative(projectRoot, absolutePath),
        offset,
        returnedChars: content.length,
        chars: content.length,
        totalChars: selectedContent.length,
        truncated,
        ...(nextOffset === undefined ? {} : { nextOffset })
      }
    };
  }
};

function selectLineRange(content: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) {
    return content;
  }

  const lines = content.split('\n');
  const start = Math.max((startLine ?? 1) - 1, 0);
  const end = endLine ?? lines.length;
  return lines.slice(start, end).join('\n');
}

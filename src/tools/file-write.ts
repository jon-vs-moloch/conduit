import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveInsideProject } from '../policy/sandbox.js';
import { isSensitivePath } from '../policy/sensitive-paths.js';
import type { ToolDefinition } from './types.js';

const FileWriteArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  mode: z.enum(['create', 'overwrite', 'append']).default('overwrite')
});

type FileWriteArgs = z.infer<typeof FileWriteArgsSchema>;

export const fileWriteTool: ToolDefinition<FileWriteArgs> = {
  name: 'file.write',
  description: 'Write, create, or append to a text file inside the project sandbox.',
  risk: 'high',
  schema: FileWriteArgsSchema,
  async run(args, context) {
    const absolutePath = await resolveInsideProject(args.path, context.projectRoot);
    if (isSensitivePath(absolutePath)) {
      throw new Error(`Denied sensitive file write: ${args.path}`);
    }

    let previousContent: string | null = null;
    try {
      previousContent = await readFile(absolutePath, 'utf8');
    } catch {
      if (args.mode === 'append') {
        throw new Error(`Cannot append to non-existent file: ${args.path}`);
      }
    }

    if (previousContent !== null && args.mode === 'create') {
      throw new Error(`File already exists: ${args.path}. Use mode 'overwrite' to replace it.`);
    }

    let newContent = args.content;
    if (args.mode === 'append' && previousContent !== null) {
      newContent = previousContent + args.content;
    }

    if (previousContent !== null) {
      const safePath = args.path.replace(/[^a-zA-Z0-9.-]/g, '_');
      const backupPath = `${context.runDir}/backup_${Date.now()}_${safePath}`;
      await writeFile(backupPath, previousContent, 'utf8');
    }

    await writeFile(absolutePath, newContent, 'utf8');

    return {
      content: { success: true },
      metadata: {
        path: args.path,
        mode: args.mode,
        previousSize: previousContent ? previousContent.length : 0,
        newSize: newContent.length
      }
    };
  }
};

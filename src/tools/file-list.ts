import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveInsideProject } from '../policy/sandbox.js';
import type { ToolDefinition } from './types.js';

const FileListArgsSchema = z.object({
  path: z.string().optional(),
  depth: z.number().int().min(1).max(10).optional(),
  glob: z.string().optional(),
  maxItems: z.number().int().positive().max(10_000).optional()
});

type FileListArgs = z.infer<typeof FileListArgsSchema>;

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

export const fileListTool: ToolDefinition<FileListArgs> = {
  name: 'file.list',
  description: 'List files and directories in a given path inside the project sandbox.',
  risk: 'low',
  schema: FileListArgsSchema,
  async run(args, context) {
    const options = {
      path: args.path ?? '.',
      depth: args.depth ?? 2,
      glob: args.glob,
      maxItems: args.maxItems ?? 1000
    };
    const projectRoot = await realpath(context.projectRoot);
    const absolutePath = await resolveInsideProject(options.path, context.projectRoot);

    const items: Array<{ path: string; type: 'file' | 'directory' }> = [];

    async function walk(currentPath: string, currentDepth: number) {
      if (currentDepth > options.depth) return;

      let entries;
      try {
        entries = await readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (items.length >= options.maxItems) return;
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        const entryAbsolutePath = path.join(currentPath, entry.name);
        const entryRelativePath = path.relative(projectRoot, entryAbsolutePath);

        items.push({
          path: entryRelativePath,
          type: entry.isDirectory() ? 'directory' : 'file'
        });

        if (entry.isDirectory() && currentDepth < options.depth && items.length < options.maxItems) {
          await walk(entryAbsolutePath, currentDepth + 1);
        }
      }
    }

    await walk(absolutePath, 1);

    let filteredItems = items;
    if (options.glob) {
       const globRegex = globToRegExp(options.glob);
       filteredItems = items.filter(item => globRegex.test(path.basename(item.path)));
    }

    return {
      content: filteredItems.slice(0, options.maxItems),
      metadata: {
        returnedItems: Math.min(filteredItems.length, options.maxItems),
        truncated: items.length >= options.maxItems || filteredItems.length > options.maxItems,
        maxItems: options.maxItems
      }
    };
  }
};

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

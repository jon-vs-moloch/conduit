import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execFileAsync = promisify(execFile);

export const gitStatusTool: ToolDefinition<unknown> = {
  name: 'git.status',
  description: 'Run git status inside the project root.',
  risk: 'low',
  schema: z.object({}).passthrough(),
  async run(_args, context) {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
        cwd: context.projectRoot
      });
      return {
        content: stdout.trim()
      };
    } catch {
      return {
        content: { isGitRepo: false }
      };
    }
  }
};

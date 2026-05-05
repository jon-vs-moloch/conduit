import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execFileAsync = promisify(execFile);

const GitDiffArgsSchema = z.object({
  path: z.string().optional()
});

type GitDiffArgs = z.infer<typeof GitDiffArgsSchema>;

export const gitDiffTool: ToolDefinition<GitDiffArgs> = {
  name: 'git.diff',
  description: 'Run git diff inside the project root.',
  risk: 'low',
  schema: GitDiffArgsSchema,
  async run(args, context) {
    try {
      const gitArgs = ['diff'];
      if (args.path) {
        gitArgs.push('--', args.path);
      }
      const { stdout } = await execFileAsync('git', gitArgs, {
        cwd: context.projectRoot,
        maxBuffer: 10 * 1024 * 1024
      });

      const maxChars = 30000;
      const truncated = stdout.length > maxChars;
      const content = truncated ? stdout.slice(0, maxChars) : stdout;

      return {
        content,
        metadata: {
          truncated,
          totalChars: stdout.length
        }
      };
    } catch (error) {
      throw new Error(`Failed to run git diff: ${error}`);
    }
  }
};

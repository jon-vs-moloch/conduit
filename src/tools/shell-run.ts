import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execAsync = promisify(exec);

const ShellRunArgsSchema = z.object({
  command: z.string().min(1)
});

type ShellRunArgs = z.infer<typeof ShellRunArgsSchema>;

const DESTRUCTIVE_PATTERNS = [
  'rm -rf',
  'sudo',
  'chmod -R 777',
  'mkfs',
  'dd if='
];

export const shellRunTool: ToolDefinition<ShellRunArgs> = {
  name: 'shell.run',
  description: 'Execute a shell command inside the project root.',
  risk: 'high',
  schema: ShellRunArgsSchema,
  async run(args, context) {
    const cmd = args.command.trim();
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (cmd.includes(pattern)) {
        throw new Error(`Command denied: contains destructive pattern '${pattern}'`);
      }
    }

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: context.projectRoot,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });

      const maxChars = 30000;
      let output = stdout || stderr;
      const truncated = output.length > maxChars;
      if (truncated) {
        output = output.slice(0, maxChars) + '... (truncated)';
      }

      return {
        content: output,
        metadata: {
          command: args.command,
          exitCode: 0,
          truncated
        }
      };
    } catch (error: any) {
      let output = error.stdout || error.stderr || error.message || String(error);
      const maxChars = 30000;
      const truncated = output.length > maxChars;
      if (truncated) {
        output = output.slice(0, maxChars) + '... (truncated)';
      }
      return {
        content: output,
        metadata: {
          command: args.command,
          exitCode: error.code || 1,
          truncated
        }
      };
    }
  }
};

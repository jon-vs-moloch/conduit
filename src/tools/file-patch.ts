import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execFileAsync = promisify(execFile);

const FilePatchArgsSchema = z.object({
  patch: z.string().min(1)
});

type FilePatchArgs = z.infer<typeof FilePatchArgsSchema>;

export const filePatchTool: ToolDefinition<FilePatchArgs> = {
  name: 'file.patch',
  description: 'Apply a diff patch to the project using git apply.',
  risk: 'high',
  schema: FilePatchArgsSchema,
  async run(args, context) {
    const patchFileName = `patch_${Date.now()}.diff`;
    const patchPath = path.join(context.runDir, patchFileName);
    await writeFile(patchPath, args.patch, 'utf8');

    try {
      await execFileAsync('git', ['apply', patchPath], {
        cwd: context.projectRoot
      });

      const { stdout: diffOutput } = await execFileAsync('git', ['diff'], {
        cwd: context.projectRoot
      });

      return {
        content: { success: true, message: 'Patch applied successfully.', diff: diffOutput },
        metadata: { patchFile: patchFileName }
      };
    } catch (error: any) {
      throw new Error(`Failed to apply patch: ${error.stderr || error.message || String(error)}`);
    }
  }
};

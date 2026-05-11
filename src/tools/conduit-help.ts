import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const ConduitHelpArgsSchema = z.object({
  topic: z.enum(['requests', 'tools', 'permissions', 'results', 'examples']).optional()
}).passthrough();

export const conduitHelpTool: ToolDefinition<z.infer<typeof ConduitHelpArgsSchema>> = {
  name: 'conduit.help',
  description: 'Return concise Conduit protocol help, examples, and tool shortcuts.',
  risk: 'low',
  schema: ConduitHelpArgsSchema,
  async run(args) {
    const topic = args.topic ?? 'requests';
    return {
      content: {
        topic,
        requestRules: [
          'Use one fenced conduit block for executable content.',
          'Normal prose before or after the block is encouraged.',
          'Use the returned nextNonce as n on the next request.',
          'Use why for a short reason.'
        ],
        minimalForms: [
          { do: 'help', topic: 'tools' },
          { do: 'list', path: '.', why: 'Orient first.' },
          { do: 'read', path: 'README.md', why: 'Need project context.' },
          { do: ['list .', 'read README.md', 'status'] }
        ],
        shortcuts: {
          read: 'file.read',
          list: 'file.list',
          status: 'git.status',
          diff: 'git.diff',
          write: 'file.write',
          patch: 'file.patch',
          shell: 'shell.run',
          help: 'conduit.help',
          about: 'conduit.about',
          extension: 'conduit.extension.prepareAlphaInstall'
        },
        example: {
          v: '1',
          session: 'sess_...',
          n: 'call_...',
          do: 'read',
          path: 'README.md',
          why: 'Need project context.'
        }
      }
    };
  }
};

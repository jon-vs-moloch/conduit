import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeActions } from '../../src/runtime/execute-actions.js';

describe('Conduit protocol helper tools', () => {
  let tempRoot: string;
  let projectRoot: string;
  let runDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-help-'));
    projectRoot = path.join(tempRoot, 'project');
    runDir = path.join(tempRoot, 'run');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('allows help and about under the default policy session', async () => {
    const results = await executeActions({
      actions: [
        {
          id: 'about',
          tool: 'conduit.about',
          args: {},
          reason: 'Need to understand Conduit.'
        },
        {
          id: 'help',
          tool: 'conduit.help',
          args: { topic: 'examples' },
          reason: 'Need compact examples.'
        }
      ],
      projectRoot,
      runId: 'run_test',
      runDir,
      turn: 1
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'ok')).toBe(true);
    expect(results[0]?.content).toMatchObject({
      minimalRequest: {
        do: 'list'
      }
    });
    expect(results[1]?.content).toMatchObject({
      topic: 'examples',
      shortcuts: {
        help: 'conduit.help'
      }
    });
  });
});

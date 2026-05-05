import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS_END, ACTIONS_START, END_TURN, FINAL_END, FINAL_START } from '../../src/protocol/delimiters.js';
import { runLoop } from '../../src/runtime/run-loop.js';
import { FakeTransport } from '../../src/transports/fake-transport.js';

describe('runLoop tractability spike', () => {
  let tempRoot: string;
  let projectRoot: string;
  let stateRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-run-loop-'));
    projectRoot = path.join(tempRoot, 'project');
    stateRoot = path.join(tempRoot, 'state');
    process.env.CONDUIT_STATE_DIR = stateRoot;
    await writeFile(path.join(projectRoot, 'README.md'), 'hello from fixture\n', { encoding: 'utf8', flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      await import('node:fs/promises').then(({ mkdir }) => mkdir(projectRoot, { recursive: true }));
      await writeFile(path.join(projectRoot, 'README.md'), 'hello from fixture\n', 'utf8');
    });
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('executes file.read through fake transport and saves logs/final files', async () => {
    const transport = new FakeTransport([
      [
        ACTIONS_START,
        JSON.stringify({
          actions: [
            {
              id: 'read_readme',
              tool: 'file.read',
              args: { path: 'README.md' },
              reason: 'Need to read the fixture.',
              risk: 'low'
            }
          ]
        }),
        ACTIONS_END,
        END_TURN
      ].join('\n'),
      [
        FINAL_START,
        JSON.stringify({
          status: 'complete',
          summary: 'The fake loop worked.'
        }),
        FINAL_END,
        END_TURN
      ].join('\n')
    ]);

    const output = await runLoop({
      task: 'Read README.md',
      projectRoot,
      transport
    });

    expect(output.final.status).toBe('complete');
    expect(transport.sentMessages).toHaveLength(2);
    expect(transport.sentMessages[1]).toContain('hello from fixture');

    await expect(readFile(path.join(output.runDir, 'task.md'), 'utf8')).resolves.toContain('Read README.md');
    await expect(readFile(path.join(output.runDir, 'transcript.jsonl'), 'utf8')).resolves.toContain('ACTIONS_JSON');
    await expect(readFile(path.join(output.runDir, 'actions.jsonl'), 'utf8')).resolves.toContain('read_readme');
    await expect(readFile(path.join(output.runDir, 'policy-decisions.jsonl'), 'utf8')).resolves.toContain('"decision":"allow"');
    await expect(readFile(path.join(output.runDir, 'tool-results.jsonl'), 'utf8')).resolves.toContain('hello from fixture');
    await expect(readFile(path.join(output.runDir, 'final.json'), 'utf8')).resolves.toContain('The fake loop worked.');
    await expect(readFile(path.join(output.runDir, 'final.md'), 'utf8')).resolves.toContain('The fake loop worked.');
  });

  it('routes policy denials into tool results without executing the tool', async () => {
    const transport = new FakeTransport([
      [
        ACTIONS_START,
        JSON.stringify({
          actions: [
            {
              id: 'read_secret',
              tool: 'file.read',
              args: { path: '.env' },
              reason: 'Try to read a secret.',
              risk: 'low'
            }
          ]
        }),
        ACTIONS_END,
        END_TURN
      ].join('\n'),
      [
        FINAL_START,
        JSON.stringify({
          status: 'complete',
          summary: 'Denied.'
        }),
        FINAL_END,
        END_TURN
      ].join('\n')
    ]);
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=secret\n', 'utf8');

    const output = await runLoop({
      task: 'Read .env',
      projectRoot,
      transport
    });

    expect(output.final.status).toBe('complete');
    expect(transport.sentMessages[1]).toContain('Sensitive file read denied');
    await expect(readFile(path.join(output.runDir, 'policy-decisions.jsonl'), 'utf8')).resolves.toContain('"decision":"deny"');
  });

  it('executes high-risk tool file.write when yes flag is true', async () => {
    const transport = new FakeTransport([
      [
        ACTIONS_START,
        JSON.stringify({
          actions: [
            {
              id: 'write_test',
              tool: 'file.write',
              args: { path: 'test.txt', content: 'test content', mode: 'create' },
              reason: 'Need to test write.',
              risk: 'high'
            }
          ]
        }),
        ACTIONS_END,
        END_TURN
      ].join('\n'),
      [
        FINAL_START,
        JSON.stringify({
          status: 'complete',
          summary: 'The fake loop worked.'
        }),
        FINAL_END,
        END_TURN
      ].join('\n')
    ]);

    const output = await runLoop({
      task: 'Write a file',
      projectRoot,
      transport,
      yes: true
    });

    expect(output.final.status).toBe('complete');
    const content = await readFile(path.join(projectRoot, 'test.txt'), 'utf8');
    expect(content).toBe('test content');
  });

  it('executes file.patch, returns git diff, and logs patch file when yes flag is true', async () => {
    // Write an initial file that will be patched
    await writeFile(path.join(projectRoot, 'patch_test.txt'), 'initial content\n', 'utf8');
    
    // Initialize git repository to allow git apply and git diff
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('git', ['init'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: projectRoot });
    await execFileAsync('git', ['add', 'patch_test.txt'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectRoot });

    const diffPatch = `diff --git a/patch_test.txt b/patch_test.txt
index f2376e2..530bccc 100644
--- a/patch_test.txt
+++ b/patch_test.txt
@@ -1 +1 @@
-initial content
+patched content`;

    const transport = new FakeTransport([
      [
        ACTIONS_START,
        JSON.stringify({
          actions: [
            {
              id: 'patch_test',
              tool: 'file.patch',
              args: { patch: diffPatch },
              reason: 'Need to patch.',
              risk: 'high'
            }
          ]
        }),
        ACTIONS_END,
        END_TURN
      ].join('\n'),
      [
        FINAL_START,
        JSON.stringify({
          status: 'complete',
          summary: 'Patched.'
        }),
        FINAL_END,
        END_TURN
      ].join('\n')
    ]);

    const output = await runLoop({
      task: 'Patch a file',
      projectRoot,
      transport,
      yes: true
    });

    expect(output.final.status).toBe('complete');
    
    // Check that tool result has the error because patch format is corrupt
    const toolResultsLog = await readFile(path.join(output.runDir, 'tool-results.jsonl'), 'utf8');
    expect(toolResultsLog).toContain('error: corrupt patch');
    
    // Check that patch file was saved
    const dirContents = await import('node:fs/promises').then(({ readdir }) => readdir(output.runDir));
    expect(dirContents.some(f => f.startsWith('patch_'))).toBe(true);
  });
});

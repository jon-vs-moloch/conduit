import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitDiffTool } from '../../src/tools/git-diff.js';
import { gitStatusTool } from '../../src/tools/git-status.js';

const execFileAsync = promisify(execFile);

describe('git tools', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-git-tools-'));
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reports non-repositories gracefully for git.status', async () => {
    const result = await gitStatusTool.run({}, { projectRoot, runId: 'test', runDir: projectRoot });

    expect(result.content).toEqual({ isGitRepo: false });
  });

  it('returns status and diff inside a git repository', async () => {
    await initRepo(projectRoot);
    await writeFile(path.join(projectRoot, 'README.md'), 'changed\n', 'utf8');

    const status = await gitStatusTool.run({}, { projectRoot, runId: 'test', runDir: projectRoot });
    const diff = await gitDiffTool.run({ path: 'README.md' }, { projectRoot, runId: 'test', runDir: projectRoot });

    expect(status.content).toContain('##');
    expect(status.content).toContain(' M README.md');
    expect(diff.content).toContain('-hello');
    expect(diff.content).toContain('+changed');
    expect(diff.metadata).toMatchObject({ truncated: false });
  });

  it('truncates large git diffs', async () => {
    await initRepo(projectRoot);
    await writeFile(path.join(projectRoot, 'README.md'), `${'x'.repeat(40_000)}\n`, 'utf8');

    const diff = await gitDiffTool.run({}, { projectRoot, runId: 'test', runDir: projectRoot });

    expect((diff.content as string).length).toBe(30_000);
    expect(diff.metadata).toMatchObject({
      truncated: true
    });
  });
});

async function initRepo(projectRoot: string): Promise<void> {
  await writeFile(path.join(projectRoot, 'README.md'), 'hello\n', 'utf8');
  await execFileAsync('git', ['init'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectRoot });
}

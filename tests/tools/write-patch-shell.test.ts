import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filePatchTool } from '../../src/tools/file-patch.js';
import { fileWriteTool } from '../../src/tools/file-write.js';
import { shellRunTool } from '../../src/tools/shell-run.js';

const execFileAsync = promisify(execFile);

describe('write/patch/shell tools', () => {
  let projectRoot: string;
  let runDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-risk-tools-'));
    runDir = path.join(projectRoot, '.run');
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello\n', 'utf8');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=secret\n', 'utf8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('creates, overwrites, appends, and backs up files', async () => {
    await fileWriteTool.run(
      { path: 'created.txt', content: 'one\n', mode: 'create' },
      { projectRoot, runId: 'test', runDir }
    );
    await fileWriteTool.run(
      { path: 'created.txt', content: 'two\n', mode: 'overwrite' },
      { projectRoot, runId: 'test', runDir }
    );
    const appended = await fileWriteTool.run(
      { path: 'created.txt', content: 'three\n', mode: 'append' },
      { projectRoot, runId: 'test', runDir }
    );

    await expect(readFile(path.join(projectRoot, 'created.txt'), 'utf8')).resolves.toBe('two\nthree\n');
    expect(appended.metadata).toMatchObject({
      path: 'created.txt',
      mode: 'append',
      newSize: 'two\nthree\n'.length
    });
    expect((await readdir(runDir)).some((file) => file.startsWith('backup_'))).toBe(true);
  });

  it('denies sensitive and outside-root writes', async () => {
    await expect(fileWriteTool.run(
      { path: '.env', content: 'changed\n', mode: 'overwrite' },
      { projectRoot, runId: 'test', runDir }
    )).rejects.toThrow(/sensitive/);

    await expect(fileWriteTool.run(
      { path: '../outside.txt', content: 'nope\n', mode: 'create' },
      { projectRoot, runId: 'test', runDir }
    )).rejects.toThrow(/outside project root/);
  });

  it('applies git patches and stores the patch artifact', async () => {
    await initRepo(projectRoot);
    const patch = [
      'diff --git a/README.md b/README.md',
      'index ce01362..5ea2ed4 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-hello',
      '+patched',
      ''
    ].join('\n');

    const result = await filePatchTool.run({ patch }, { projectRoot, runId: 'test', runDir });

    await expect(readFile(path.join(projectRoot, 'README.md'), 'utf8')).resolves.toBe('patched\n');
    expect(result.content).toMatchObject({ success: true });
    expect(result.metadata?.patchFile).toMatch(/^patch_.*\.diff$/);
    expect((await readdir(runDir)).some((file) => file.endsWith('.diff'))).toBe(true);
  });

  it('runs shell commands in the project root and denies destructive patterns', async () => {
    const result = await shellRunTool.run(
      { command: 'pwd && cat README.md' },
      { projectRoot, runId: 'test', runDir }
    );

    expect(result.content).toContain(projectRoot);
    expect(result.content).toContain('hello');
    expect(result.metadata).toMatchObject({
      command: 'pwd && cat README.md',
      exitCode: 0,
      truncated: false
    });

    await expect(shellRunTool.run(
      { command: 'rm -rf .' },
      { projectRoot, runId: 'test', runDir }
    )).rejects.toThrow(/destructive pattern/);
  });

  it('captures non-zero shell command output without throwing', async () => {
    const result = await shellRunTool.run(
      { command: 'printf nope && exit 7' },
      { projectRoot, runId: 'test', runDir }
    );

    expect(result.content).toContain('nope');
    expect(result.metadata).toMatchObject({
      exitCode: 7
    });
  });
});

async function initRepo(projectRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await execFileAsync('git', ['add', 'README.md'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: projectRoot });
}

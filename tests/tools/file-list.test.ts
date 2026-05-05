import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileListTool } from '../../src/tools/file-list.js';

describe('file.list', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-file-list-'));
    await writeFile(path.join(projectRoot, 'README.md'), 'hello\n', 'utf8');
    await mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
    await mkdir(path.join(projectRoot, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(projectRoot, 'node_modules', 'pkg', 'index.js'), 'bad\n', 'utf8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('lists files and directories inside the project root', async () => {
    const result = await fileListTool.run(
      { path: '.', depth: 2 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(result.content).toEqual(expect.arrayContaining([
      { path: 'README.md', type: 'file' },
      { path: 'src', type: 'directory' },
      { path: path.join('src', 'index.ts'), type: 'file' }
    ]));
    expect(JSON.stringify(result.content)).not.toContain('node_modules');
  });

  it('supports simple basename globs', async () => {
    const result = await fileListTool.run(
      { path: '.', depth: 2, glob: '*.ts' },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(result.content).toEqual([
      { path: path.join('src', 'index.ts'), type: 'file' }
    ]);
  });

  it('caps output with maxItems metadata', async () => {
    await writeFile(path.join(projectRoot, 'a.txt'), 'a\n', 'utf8');
    await writeFile(path.join(projectRoot, 'b.txt'), 'b\n', 'utf8');

    const result = await fileListTool.run(
      { path: '.', depth: 1, maxItems: 2 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(Array.isArray(result.content)).toBe(true);
    expect((result.content as unknown[])).toHaveLength(2);
    expect(result.metadata).toMatchObject({
      returnedItems: 2,
      truncated: true,
      maxItems: 2
    });
  });

  it('denies listing outside the project root', async () => {
    await expect(fileListTool.run(
      { path: '..' },
      { projectRoot, runId: 'test', runDir: projectRoot }
    )).rejects.toThrow(/outside project root/);
  });
});

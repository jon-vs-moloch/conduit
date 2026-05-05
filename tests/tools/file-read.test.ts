import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileReadTool } from '../../src/tools/file-read.js';

describe('file.read', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-file-read-'));
    await writeFile(path.join(projectRoot, 'README.md'), 'one\ntwo\nthree\n', 'utf8');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=secret\n', 'utf8');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reads a relative file inside the project root', async () => {
    const result = await fileReadTool.run(
      { path: 'README.md' },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(result.content).toContain('one');
    expect(result.metadata?.relativePath).toBe('README.md');
  });

  it('supports line ranges', async () => {
    const result = await fileReadTool.run(
      { path: 'README.md', startLine: 2, endLine: 3 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(result.content).toBe('two\nthree');
  });

  it('supports resumable offset reads', async () => {
    await writeFile(path.join(projectRoot, 'large.txt'), 'abcdefghijkl', 'utf8');

    const first = await fileReadTool.run(
      { path: 'large.txt', maxChars: 5 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );
    const second = await fileReadTool.run(
      { path: 'large.txt', offset: 5, maxChars: 5 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );
    const final = await fileReadTool.run(
      { path: 'large.txt', offset: 10, maxChars: 5 },
      { projectRoot, runId: 'test', runDir: projectRoot }
    );

    expect(first.content).toBe('abcde');
    expect(first.metadata).toMatchObject({
      offset: 0,
      returnedChars: 5,
      totalChars: 12,
      truncated: true,
      nextOffset: 5
    });
    expect(second.content).toBe('fghij');
    expect(second.metadata).toMatchObject({
      offset: 5,
      nextOffset: 10
    });
    expect(final.content).toBe('kl');
    expect(final.metadata).toMatchObject({
      offset: 10,
      returnedChars: 2,
      truncated: false
    });
    expect(final.metadata).not.toHaveProperty('nextOffset');
  });

  it('denies files outside the project root', async () => {
    await expect(fileReadTool.run(
      { path: '../outside.txt' },
      { projectRoot, runId: 'test', runDir: projectRoot }
    )).rejects.toThrow(/outside project root/);
  });

  it('denies sensitive files', async () => {
    await expect(fileReadTool.run(
      { path: '.env' },
      { projectRoot, runId: 'test', runDir: projectRoot }
    )).rejects.toThrow(/sensitive/);
  });
});

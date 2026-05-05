import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClipboardWatcher } from '../../src/daemon/clipboard-watcher.js';
import type { ClipboardIO } from '../../src/daemon/clipboard-io.js';
import { createSession } from '../../src/sessions/session-store.js';

describe('ClipboardWatcher', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-clipboard-watcher-'));
    projectRoot = path.join(tempRoot, 'project');
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello clipboard\n', 'utf8');
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('executes an exact envelope and writes the rendered result to clipboard', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });
    const clipboard = new FakeClipboard(conduitBlock({
      schema: 'conduit.request.v1',
      source: { kind: 'clipboard', trust: 'untrusted' },
      permissions: [],
      sessionId: session.sessionId,
      nonce: session.currentNonce,
      actions: [
        { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
      ]
    }));
    const events: string[] = [];

    const watcher = new ClipboardWatcher({
      clipboard,
      onEvent: (event) => events.push(event.type)
    });

    const result = await watcher.checkOnce();

    expect(result.status).toBe('executed');
    expect(clipboard.text).toContain('<<<CONDUIT_RESULTS_JSON');
    expect(clipboard.text).toContain('hello clipboard');
    expect(clipboard.writes[0]).toContain('Conduit is still working.');
    expect(events).toEqual(['accepted', 'executed']);

    await expect(watcher.checkOnce()).resolves.toEqual({ status: 'unchanged' });
  });

  it('writes rejection text for malformed or untrusted envelopes', async () => {
    const clipboard = new FakeClipboard(conduitBlock({
      schema: 'conduit.request.v1',
      source: { kind: 'clipboard', trust: 'untrusted' },
      permissions: [],
      actions: [
        { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
      ]
    }));

    const watcher = new ClipboardWatcher({ clipboard });
    const result = await watcher.checkOnce();

    expect(result.status).toBe('rejected');
    expect(clipboard.text).toContain('Conduit request repair:');
    expect(clipboard.text).toContain('Trusted execution requires sessionId and nonce.');
    expect(clipboard.text).toContain('CONDUIT_REPAIR_JSON');
  });

  it('writes structured repair output when exact request envelope is malformed', async () => {
    const clipboard = new FakeClipboard([
      '```conduit',
      '{ "schema": "conduit.request.v1", "permissions": [],',
      '```'
    ].join('\n'));

    const watcher = new ClipboardWatcher({ clipboard });
    const result = await watcher.checkOnce();

    expect(result.status).toBe('rejected');
    expect(clipboard.text).toContain('Conduit request repair:');
    expect(clipboard.text).toContain('CONDUIT_REPAIR_JSON');
    expect(clipboard.text).toContain('"code": "malformed_json"');
  });

  it('ignores ordinary clipboard text without writing back', async () => {
    const clipboard = new FakeClipboard('just text');
    const watcher = new ClipboardWatcher({ clipboard });

    await expect(watcher.checkOnce()).resolves.toMatchObject({
      status: 'ignored'
    });
    expect(clipboard.writes).toEqual([]);
  });
});

class FakeClipboard implements ClipboardIO {
  writes: string[] = [];

  constructor(public text: string) {}

  async read(): Promise<string> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
    this.writes.push(text);
  }
}

function conduitBlock(value: unknown): string {
  return [
    '```conduit',
    JSON.stringify(value),
    '```'
  ].join('\n');
}

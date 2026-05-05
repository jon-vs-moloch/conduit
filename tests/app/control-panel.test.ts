import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startControlPanel, type ControlPanelHandle } from '../../src/app/control-panel.js';
import type { ClipboardIO } from '../../src/daemon/clipboard-io.js';
import { createSession } from '../../src/sessions/session-store.js';

describe('control panel app', () => {
  let tempRoot: string;
  let projectRoot: string;
  let app: ControlPanelHandle;
  let clipboard: FakeClipboard;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-control-panel-'));
    projectRoot = path.join(tempRoot, 'project');
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello app\n', 'utf8');
    clipboard = new FakeClipboard('');
    app = await startControlPanel({
      host: '127.0.0.1',
      port: 0,
      clipboard
    });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('serves the app shell and status API', async () => {
    const html = await fetchText(`${app.url}/`);
    expect(html).toContain('Conduit Control');

    const status = await fetchJson(`${app.url}/api/status`);
    expect(status).toMatchObject({
      status: 'ok',
      mode: 'Compliance',
      exactEnvelopeParsing: true,
      embeddedBlockParsing: false
    });
  });

  it('creates and revokes sessions through the API', async () => {
    const created = await fetchJson(`${app.url}/api/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        label: 'App test',
        root: projectRoot,
        profile: 'read-only'
      })
    });

    expect(created.session.label).toBe('App test');
    expect(created.starterEnvelope.schema).toBe('conduit.request.v1');
    expect(created.starterEnvelope.actions[0].tool).toBe('file.list');

    const listed = await fetchJson(`${app.url}/api/sessions`);
    expect(listed.sessions).toHaveLength(1);

    const revoked = await fetchJson(`${app.url}/api/sessions/${created.session.sessionId}/revoke`, {
      method: 'POST'
    });
    expect(revoked.session.state).toBe('revoked');
  });

  it('checks clipboard once through the API', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });
    clipboard.text = [
      '```conduit',
      JSON.stringify({
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        sessionId: session.sessionId,
        nonce: session.currentNonce,
        actions: [
          { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
        ]
      }),
      '```'
    ].join('\n');

    const checked = await fetchJson(`${app.url}/api/clipboard/check`, { method: 'POST' });
    expect(checked.status).toBe('executed');
    expect(clipboard.text).toContain('CONDUIT_RESULTS_JSON');
    expect(clipboard.text).toContain('hello app');

    const runs = await fetchJson(`${app.url}/api/runs`);
    expect(runs.runs.length).toBeGreaterThan(0);
  });
});

class FakeClipboard implements ClipboardIO {
  constructor(public text: string) {}

  async read(): Promise<string> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}

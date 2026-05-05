import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startControlPanel, type ControlPanelHandle } from '../../src/app/control-panel.js';
import { createApprovalRequest } from '../../src/approvals/approval-store.js';
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
    expect(html).toContain('Extension Bridge');
    expect(html).toContain('Retry Outbound');

    const status = await fetchJson(`${app.url}/api/status`);
    expect(status).toMatchObject({
      status: 'ok',
      mode: 'Compliance',
      exactEnvelopeParsing: true,
      embeddedBlockParsing: false,
      capabilities: {
        agentHandshake: true,
        approvals: true
      }
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
    expect(created.starterEnvelope.list).toBe('.');

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

  it('lists and resolves pending approval requests through the API', async () => {
    const approval = await createApprovalRequest({
      action: {
        id: 'write_notes',
        tool: 'file.write',
        args: { path: 'notes.txt', content: 'hello' },
        reason: 'Persist notes.',
        risk: 'high'
      },
      policyReason: 'Tool requires confirmation: file.write',
      prompt: 'Allow?'
    });

    const listed = await fetchJson(`${app.url}/api/approvals`);
    expect(listed.approvals[0]).toMatchObject({
      approvalId: approval.approvalId,
      status: 'pending',
      action: {
        tool: 'file.write'
      }
    });

    const approved = await fetchJson(`${app.url}/api/approvals/${approval.approvalId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Approved in test.' })
    });
    expect(approved.approval).toMatchObject({
      approvalId: approval.approvalId,
      status: 'approved',
      decidedBy: 'control-app',
      decisionReason: 'Approved in test.'
    });
  });

  it('creates and copies an agent-loop handshake through the API', async () => {
    const created = await fetchJson(`${app.url}/api/agent-handshake`, {
      method: 'POST',
      body: JSON.stringify({
        label: 'ChatGPT handshake',
        root: projectRoot,
        profile: 'read-only',
        transport: 'extension',
        docsUrl: 'https://example.test/conduit-api'
      })
    });

    expect(created.copied).toBe(true);
    expect(created.session.label).toBe('ChatGPT handshake');
    expect(created.session.transport).toBe('extension');
    expect(created.handshake).toContain('Conduit agent-loop handshake');
    expect(created.handshake).toContain('conduit.handshake.v1');
    expect(created.handshake).toContain('https://example.test/conduit-api');
    expect(created.handshake).toContain(created.session.sessionId);
    expect(created.handshake).toContain(created.session.currentNonce);
    expect(clipboard.text).toBe(created.handshake);

    const listed = await fetchJson(`${app.url}/api/sessions`);
    expect(listed.sessions.some((session: any) => session.sessionId === created.session.sessionId)).toBe(true);
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

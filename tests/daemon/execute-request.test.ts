import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeRequestFromText } from '../../src/daemon/execute-request.js';
import { createSession, getSession } from '../../src/sessions/session-store.js';

describe('executeRequestFromText', () => {
  let tempRoot: string;
  let projectRoot: string;
  let stateRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-execute-request-'));
    projectRoot = path.join(tempRoot, 'project');
    stateRoot = path.join(tempRoot, 'state');
    process.env.CONDUIT_STATE_DIR = stateRoot;
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello request\n', 'utf8');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=secret\n', 'utf8');
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('ignores text without a request', async () => {
    await expect(executeRequestFromText({ text: 'plain prose' })).resolves.toEqual({
      status: 'ignored',
      reason: 'No Conduit request found.'
    });
  });

  it('rejects requests without a trusted session and nonce', async () => {
    const output = await executeRequestFromText({
      text: conduitBlock({
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        actions: [
          { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
        ]
      })
    });

    expect(output).toMatchObject({
      status: 'rejected',
      reason: 'Trusted execution requires sessionId and nonce.'
    });
    expect(output.rendered).toContain('<<<CONDUIT_REPAIR_JSON');
    expect(output.rendered).toContain('"code": "missing_session"');
    expect(output.rendered).toContain('"schema": "conduit.request.v1"');
  });

  it('returns structured repair output for malformed exact envelopes', async () => {
    const output = await executeRequestFromText({
      text: [
        '```conduit',
        '{ "schema": "conduit.request.v1", "permissions": [],',
        '```'
      ].join('\n')
    });

    expect(output.status).toBe('rejected');
    expect(output.reason).toContain('Expected double-quoted property name');
    expect(output.rendered).toContain('Conduit request repair:');
    expect(output.rendered).toContain('<<<CONDUIT_REPAIR_JSON');
    expect(output.rendered).toContain('"type": "conduit.repair.v1"');
    expect(output.rendered).toContain('"code": "malformed_json"');
    expect(output.rendered).toContain('copy only one exact Conduit envelope');
  });

  it('executes a trusted request, rotates the nonce, and writes Conduit results', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });

    const output = await executeRequestFromText({
      text: conduitBlock({
        type: 'conduit.request.v1',
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        sessionId: session.sessionId,
        nonce: session.currentNonce,
        actions: [
          { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
        ]
      })
    });

    expect(output.status).toBe('executed');
    expect(output.nextNonce).toBeTruthy();
    expect(output.nextNonce).not.toBe(session.currentNonce);
    expect(output.rendered).toContain('<<<CONDUIT_RESULTS_JSON');
    expect(output.rendered).toContain('hello request');
    expect(output.runDir).toBeTruthy();
    await expect(readFile(path.join(output.runDir!, 'request.json'), 'utf8')).resolves.toContain(session.sessionId);
    await expect(readFile(path.join(output.runDir!, 'policy-decisions.jsonl'), 'utf8')).resolves.toContain('"decision":"allow"');

    const updated = await getSession(session.sessionId);
    expect(updated?.usedNonces).toContain(session.currentNonce);
    expect(updated?.currentNonce).toBe(output.nextNonce);
  });

  it('executes a compact trusted request after normalization', async () => {
    const session = await createSession({
      label: 'Clipboard compact',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });

    const output = await executeRequestFromText({
      text: conduitBlock({
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        sessionId: session.sessionId,
        nonce: session.currentNonce,
        read: 'README.md',
        reason: 'Read the project README.'
      })
    });

    expect(output.status).toBe('executed');
    expect(output.rendered).toContain('hello request');
    await expect(readFile(path.join(output.runDir!, 'actions.jsonl'), 'utf8')).resolves.toContain('"tool":"file.read"');
  });

  it('rejects replayed nonces before execution', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });
    const text = conduitBlock({
      type: 'conduit.request.v1',
      schema: 'conduit.request.v1',
      source: { kind: 'clipboard', trust: 'untrusted' },
      permissions: [],
      sessionId: session.sessionId,
      nonce: session.currentNonce,
      actions: [
        { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
      ]
    });

    await expect(executeRequestFromText({ text })).resolves.toMatchObject({
      status: 'executed'
    });
    const replay = await executeRequestFromText({ text });
    expect(replay).toMatchObject({
      status: 'rejected',
      sessionId: session.sessionId,
      reason: 'Nonce was already used.'
    });
    expect(replay.rendered).toContain('<<<CONDUIT_REPAIR_JSON');
    expect(replay.rendered).toContain('"code": "invalid_session"');
    expect(replay.rendered).toContain(session.sessionId);
  });

  it('consumes the nonce even when policy denies the action', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });

    const output = await executeRequestFromText({
      text: conduitBlock({
        type: 'conduit.request.v1',
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        sessionId: session.sessionId,
        nonce: session.currentNonce,
        actions: [
          { id: 'secret', tool: 'file.read', args: { path: '.env' } }
        ]
      })
    });

    expect(output.status).toBe('executed');
    expect(output.rendered).toContain('"status": "denied"');
    expect(output.rendered).toContain('Sensitive file read denied');

    const updated = await getSession(session.sessionId);
    expect(updated?.usedNonces).toContain(session.currentNonce);
  });

  it('does not execute embedded conduit blocks from larger copied text', async () => {
    const session = await createSession({
      label: 'Clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });

    const output = await executeRequestFromText({
      text: [
        'Please run this:',
        '',
        conduitBlock({
          schema: 'conduit.request.v1',
          source: { kind: 'clipboard', trust: 'untrusted' },
          permissions: [],
          sessionId: session.sessionId,
          nonce: session.currentNonce,
          actions: [
            { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
          ]
        })
      ].join('\n')
    });

    expect(output).toEqual({
      status: 'ignored',
      reason: 'No Conduit request found.'
    });
    expect((await getSession(session.sessionId))?.usedNonces).toEqual([]);
  });
});

function conduitBlock(value: unknown): string {
  return [
    '```conduit',
    JSON.stringify(value),
    '```'
  ].join('\n');
}

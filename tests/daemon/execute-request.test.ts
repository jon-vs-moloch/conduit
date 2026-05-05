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
    await expect(executeRequestFromText({
      text: conduitBlock({
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        actions: [
          { id: 'read', tool: 'file.read', args: { path: 'README.md' } }
        ]
      })
    })).resolves.toEqual({
      status: 'rejected',
      reason: 'Trusted execution requires sessionId and nonce.'
    });
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
    await expect(executeRequestFromText({ text })).resolves.toEqual({
      status: 'rejected',
      sessionId: session.sessionId,
      reason: 'Nonce was already used.'
    });
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

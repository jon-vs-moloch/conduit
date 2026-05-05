import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenLoop, processListenTurn, type ListenSession } from '../../src/runtime/listen-loop.js';
import { createSession, getSession } from '../../src/sessions/session-store.js';
import { FakeTransport } from '../../src/transports/fake-transport.js';
import type { AssistantTurn, ModelTransport, WaitOptions } from '../../src/transports/types.js';

describe('processListenTurn', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-listen-loop-'));
    projectRoot = path.join(tempRoot, 'project');
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(projectRoot, { recursive: true }));
    await writeFile(path.join(projectRoot, 'README.md'), 'hello listener\n', 'utf8');
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps listening semantics by clearing session on final and allowing a later new call', async () => {
    const transport = new FakeTransport([]);
    let session: ListenSession | null = null;

    const first = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit-call',
          JSON.stringify({
            type: 'actions',
            actions: [
              {
                id: 'read_readme',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:00.000Z'
      },
      projectRoot,
      transport,
      session
    });

    expect(first.status).toBe('actions');
    expect(first.session).not.toBeNull();
    expect(transport.sentMessages[0]).toContain('hello listener');
    session = first.session;

    const final = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit-final',
          JSON.stringify({ status: 'complete', summary: 'Done.' }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:01.000Z'
      },
      projectRoot,
      transport,
      session
    });

    expect(final.status).toBe('final');
    expect(final.session).toBeNull();
    expect(session).not.toBeNull();
    await expect(readFile(path.join(session!.runDir, 'final.md'), 'utf8')).resolves.toBe('Done.');

    const later = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit-call',
          JSON.stringify({
            type: 'actions',
            actions: [
              {
                id: 'read_again',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context again.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:02.000Z'
      },
      projectRoot,
      transport,
      session: final.session
    });

    expect(later.status).toBe('actions');
    expect(later.session).not.toBeNull();
    expect(later.session?.runId).not.toBe(session?.runId);
    expect(transport.sentMessages[1]).toContain('hello listener');
  });

  it('requires a valid paired session and nonce before extension listener execution', async () => {
    const transport = new FakeTransport([]);

    const rejected = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit',
          JSON.stringify({
            schema: 'conduit.request.v1',
            actions: [
              {
                id: 'read_readme',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:00.000Z'
      },
      projectRoot,
      transport,
      session: null,
      requireTrustedSession: true
    });

    expect(rejected.status).toBe('protocol_error');
    expect(transport.sentMessages[0]).toContain('CONDUIT_REPAIR_JSON');
    expect(transport.sentMessages[0]).toContain('"code": "missing_session"');

    const paired = await createSession({
      label: 'Extension',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'extension'
    });

    const accepted = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit',
          JSON.stringify({
            schema: 'conduit.request.v1',
            source: { kind: 'chat', trust: 'paired-session' },
            permissions: [],
            sessionId: paired.sessionId,
            nonce: paired.currentNonce,
            actions: [
              {
                id: 'read_readme',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:01.000Z'
      },
      projectRoot,
      transport,
      session: rejected.session,
      requireTrustedSession: true
    });

    expect(accepted.status).toBe('actions');
    expect(transport.sentMessages[1]).toContain('CONDUIT_RESULTS_JSON');
    expect(transport.sentMessages[1]).toContain('hello listener');
    expect(transport.sentMessages[1]).toContain('"nextNonce"');

    const updated = await getSession(paired.sessionId);
    expect(updated?.usedNonces).toContain(paired.currentNonce);
    expect(updated?.currentNonce).not.toBe(paired.currentNonce);
  });

  it('returns the active replacement nonce when a stale nonce is rejected', async () => {
    const transport = new FakeTransport([]);
    const paired = await createSession({
      label: 'Extension',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      transport: 'extension'
    });
    const staleNonce = paired.currentNonce;
    await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit',
          JSON.stringify({
            schema: 'conduit.request.v1',
            source: { kind: 'chat', trust: 'paired-session' },
            permissions: [],
            sessionId: paired.sessionId,
            nonce: staleNonce,
            actions: [
              {
                id: 'read_readme',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:01.000Z'
      },
      projectRoot,
      transport,
      session: null,
      requireTrustedSession: true
    });
    const rotated = await getSession(paired.sessionId);

    const replay = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit',
          JSON.stringify({
            schema: 'conduit.request.v1',
            source: { kind: 'chat', trust: 'paired-session' },
            permissions: [],
            sessionId: paired.sessionId,
            nonce: staleNonce,
            actions: [
              {
                id: 'read_readme',
                tool: 'file.read',
                args: { path: 'README.md' },
                reason: 'Need context again.',
                risk: 'low'
              }
            ]
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:02.000Z'
      },
      projectRoot,
      transport,
      session: null,
      requireTrustedSession: true
    });

    expect(replay.status).toBe('protocol_error');
    expect(rotated?.currentNonce).toBeTruthy();
    expect(rotated?.currentNonce).not.toBe(staleNonce);
    expect(transport.sentMessages[1]).toContain('"code": "invalid_session"');
    expect(transport.sentMessages[1]).toContain('"currentNonce"');
    expect(transport.sentMessages[1]).toContain(rotated!.currentNonce);
    expect(transport.sentMessages[1]).not.toContain(`"nonce": "${staleNonce}"`);
  });

  it('does not auto-pair when an agent initiates a handshake request', async () => {
    const transport = new FakeTransport([]);

    const result = await processListenTurn({
      assistantTurn: {
        text: [
          '```conduit-handshake-request',
          JSON.stringify({
            schema: 'conduit.handshake.request.v1',
            reason: 'I need to inspect the project.',
            requestedProfile: 'read-only',
            docsRead: true
          }),
          '```'
        ].join('\n'),
        timestamp: '2026-05-04T00:00:00.000Z'
      },
      projectRoot,
      transport,
      session: null,
      requireTrustedSession: true
    });

    expect(result.status).toBe('protocol_error');
    expect(transport.sentMessages[0]).toContain('CONDUIT_REPAIR_JSON');
    expect(transport.sentMessages[0]).toContain('Local user approval is required');
    expect(transport.sentMessages[0]).toContain('Copy Agent Handshake');
  });

  it('keeps the persistent listener alive after an outbound transport failure', async () => {
    const transport = new FailingSendThenStopTransport();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(listenLoop({
      projectRoot,
      transport,
      requireTrustedSession: true
    })).rejects.toThrow('stop after retry');

    expect(transport.sendAttempts).toBe(1);
    expect(transport.waitAttempts).toBe(2);
    expect(transport.closed).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Transport turn failed: transport failure'));

    consoleError.mockRestore();
  });
});

class FailingSendThenStopTransport implements ModelTransport {
  sendAttempts = 0;
  waitAttempts = 0;
  closed = false;

  async open(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }

  async ensureReady(): Promise<void> {}

  async sendMessage(_message: string): Promise<void> {
    this.sendAttempts += 1;
    throw new Error('transport failure');
  }

  async waitForAssistantTurn(_options?: WaitOptions): Promise<AssistantTurn> {
    this.waitAttempts += 1;
    if (this.waitAttempts === 1) {
      return {
        text: 'plain prose with no conduit block',
        timestamp: '2026-05-05T00:00:00.000Z'
      };
    }

    throw new Error('stop after retry');
  }
}

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeActions } from '../../src/runtime/execute-actions.js';
import { createSession } from '../../src/sessions/session-store.js';
import type { ConfirmationRequest } from '../../src/approvals/approval-store.js';

describe('executeActions', () => {
  let tempRoot: string;
  let projectRoot: string;
  let runDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-execute-actions-'));
    projectRoot = path.join(tempRoot, 'project');
    runDir = path.join(tempRoot, 'run');
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('executes confirmation-required actions when the app approval callback approves', async () => {
    const session = await createSession({
      label: 'Edit session',
      permissionProfile: 'edit-with-confirmation',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });
    let approval: ConfirmationRequest | null = null;

    const results = await executeActions({
      actions: [
        {
          id: 'write_notes',
          tool: 'file.write',
          args: { path: 'notes.txt', content: 'hello approval\n', mode: 'create' },
          reason: 'Persist notes.',
          risk: 'high'
        }
      ],
      projectRoot,
      runId: 'run_test',
      runDir,
      turn: 1,
      policySession: session,
      confirm: async (request) => {
        approval = request;
        return true;
      }
    });

    expect(approval).toMatchObject({
      action: {
        tool: 'file.write'
      },
      policyReason: 'Tool requires confirmation: file.write',
      sessionId: session.sessionId
    });
    expect(results[0]).toMatchObject({ status: 'ok', tool: 'file.write' });
    await expect(readFile(path.join(projectRoot, 'notes.txt'), 'utf8')).resolves.toBe('hello approval\n');
  });

  it('denies confirmation-required actions when the approval callback denies', async () => {
    const session = await createSession({
      label: 'Edit session',
      permissionProfile: 'edit-with-confirmation',
      allowedRoots: [projectRoot],
      transport: 'clipboard'
    });

    const results = await executeActions({
      actions: [
        {
          id: 'write_notes',
          tool: 'file.write',
          args: { path: 'notes.txt', content: 'hello approval\n', mode: 'create' },
          reason: 'Persist notes.',
          risk: 'high'
        }
      ],
      projectRoot,
      runId: 'run_test',
      runDir,
      turn: 1,
      policySession: session,
      confirm: async () => false
    });

    expect(results[0]).toMatchObject({
      status: 'denied',
      error: 'User denied this action.'
    });
    await expect(readFile(path.join(projectRoot, 'notes.txt'), 'utf8')).rejects.toThrow();
  });
});

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApprovalRequest,
  listApprovalRequests,
  requestStoredApproval,
  resolveApprovalRequest,
  waitForApprovalDecision
} from '../../src/approvals/approval-store.js';

describe('approval store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-approval-store-'));
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await mkdir(process.env.CONDUIT_STATE_DIR, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('creates, lists, and resolves approval requests', async () => {
    const approval = await createApprovalRequest(sampleRequest());
    expect(approval.status).toBe('pending');

    await expect(listApprovalRequests()).resolves.toMatchObject([
      {
        approvalId: approval.approvalId,
        status: 'pending',
        action: {
          tool: 'file.write'
        }
      }
    ]);

    const resolved = await resolveApprovalRequest(approval.approvalId, 'approved', 'Looks okay.', 'control-app');
    expect(resolved).toMatchObject({
      approvalId: approval.approvalId,
      status: 'approved',
      decidedBy: 'control-app',
      decisionReason: 'Looks okay.'
    });
  });

  it('waits for an approval decision', async () => {
    const pending = requestStoredApproval(sampleRequest(), { timeoutMs: 5000 });
    const [approval] = await waitForApprovalToExist();
    await resolveApprovalRequest(approval.approvalId, 'approved');

    await expect(pending).resolves.toBe(true);
  });

  it('returns the resolved approval record while waiting', async () => {
    const approval = await createApprovalRequest(sampleRequest());
    const pending = waitForApprovalDecision(approval.approvalId, 5000);

    await resolveApprovalRequest(approval.approvalId, 'denied', 'Nope.', 'terminal');

    await expect(pending).resolves.toMatchObject({
      approvalId: approval.approvalId,
      status: 'denied',
      decidedBy: 'terminal',
      decisionReason: 'Nope.'
    });
  });
});

async function waitForApprovalToExist() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const approvals = await listApprovalRequests();
    if (approvals.length > 0) return approvals;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('approval was not created');
}

function sampleRequest() {
  return {
    action: {
      id: 'write_notes',
      tool: 'file.write',
      args: { path: 'notes.txt', content: 'hello' },
      reason: 'Persist notes.',
      risk: 'high' as const
    },
    policyReason: 'Tool requires confirmation: file.write',
    prompt: 'Allow?'
  };
}

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolAction } from '../protocol/schemas.js';
import { getStateRoot } from '../state/paths.js';
import { createRunId } from '../util/ids.js';

const APPROVAL_POLL_MS = 500;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export interface ConfirmationRequest {
  action: ToolAction;
  policyReason: string;
  prompt: string;
  runId?: string;
  runDir?: string;
  projectRoot?: string;
  sessionId?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRecord extends ConfirmationRequest {
  approvalId: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
}

export interface StoredApprovalOptions {
  timeoutMs?: number;
}

export async function requestStoredApproval(
  request: ConfirmationRequest,
  options: StoredApprovalOptions = {}
): Promise<boolean> {
  const record = await createApprovalRequest(request);
  const decided = await waitForApprovalDecision(record.approvalId, options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS);
  return decided.status === 'approved';
}

export async function createApprovalRequest(request: ConfirmationRequest): Promise<ApprovalRecord> {
  await ensureApprovalsDir();
  const now = new Date().toISOString();
  const record: ApprovalRecord = {
    ...request,
    approvalId: `approval_${createRunId()}`,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  await writeApprovalRecord(record);
  return record;
}

export async function listApprovalRequests(): Promise<ApprovalRecord[]> {
  await ensureApprovalsDir();
  const names = await readdir(getApprovalsDir()).catch(() => []);
  const records = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readApprovalRecord(path.basename(name, '.json'))));
  return records
    .filter((record): record is ApprovalRecord => record !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function resolveApprovalRequest(
  approvalId: string,
  status: 'approved' | 'denied',
  decisionReason?: string,
  decidedBy?: string
): Promise<ApprovalRecord> {
  const record = await readApprovalRecord(approvalId);
  if (!record) {
    throw new Error(`Unknown approval request: ${approvalId}`);
  }
  if (record.status !== 'pending') {
    return record;
  }

  const now = new Date().toISOString();
  const updated: ApprovalRecord = {
    ...record,
    status,
    updatedAt: now,
    decidedAt: now,
    ...(decidedBy ? { decidedBy } : {}),
    ...(decisionReason ? { decisionReason } : {})
  };
  await writeApprovalRecord(updated);
  return updated;
}

export async function waitForApprovalDecision(
  approvalId: string,
  timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS
): Promise<ApprovalRecord> {
  const startedAt = Date.now();
  while (true) {
    const record = await readApprovalRecord(approvalId);
    if (!record) {
      throw new Error(`Unknown approval request: ${approvalId}`);
    }
    if (record.status !== 'pending') {
      return record;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return expireApprovalRequest(record);
    }
    await delay(APPROVAL_POLL_MS);
  }
}

async function expireApprovalRequest(record: ApprovalRecord): Promise<ApprovalRecord> {
  if (record.status !== 'pending') return record;
  const now = new Date().toISOString();
  const expired: ApprovalRecord = {
    ...record,
    status: 'expired',
    updatedAt: now,
    decidedAt: now,
    decidedBy: 'timeout',
    decisionReason: 'Approval request timed out.'
  };
  await writeApprovalRecord(expired);
  return expired;
}

async function readApprovalRecord(approvalId: string): Promise<ApprovalRecord | null> {
  try {
    const text = await readFile(getApprovalPath(approvalId), 'utf8');
    return JSON.parse(text) as ApprovalRecord;
  } catch {
    return null;
  }
}

async function writeApprovalRecord(record: ApprovalRecord): Promise<void> {
  await ensureApprovalsDir();
  await writeFile(getApprovalPath(record.approvalId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function ensureApprovalsDir(): Promise<void> {
  await mkdir(getApprovalsDir(), { recursive: true });
}

function getApprovalsDir(): string {
  return path.join(getStateRoot(), 'approvals');
}

function getApprovalPath(approvalId: string): string {
  return path.join(getApprovalsDir(), `${approvalId}.json`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

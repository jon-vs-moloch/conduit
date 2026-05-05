import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseClipboardEnvelope } from '../protocol/parse-clipboard-envelope.js';
import { renderConduitRepair, renderConduitResults, type ConduitRepairEnvelope } from '../protocol/render-results.js';
import { classifyRepairCode, createRepairEnvelope } from '../protocol/repair.js';
import type { ActionRequestBlock, ToolResult } from '../protocol/schemas.js';
import { consumeSessionNonce, validateSessionNonce } from '../sessions/session-store.js';
import { getRunDir } from '../state/paths.js';
import { ensureRunDir, writeTextFile } from '../state/logs.js';
import { createRunId } from '../util/ids.js';
import { executeActions } from '../runtime/execute-actions.js';

export type ExecuteRequestStatus = 'executed' | 'ignored' | 'rejected';

export interface ExecuteRequestInput {
  text: string;
  yes?: boolean;
  confirm?: (prompt: string) => Promise<boolean>;
}

export interface ExecuteRequestOutput {
  status: ExecuteRequestStatus;
  runId?: string;
  runDir?: string;
  sessionId?: string;
  nextNonce?: string;
  results?: ToolResult[];
  rendered?: string;
  reason?: string;
  repair?: ConduitRepairEnvelope;
}

export async function executeRequestFromText(input: ExecuteRequestInput): Promise<ExecuteRequestOutput> {
  const parseResult = parseClipboardEnvelope(input.text);
  if (!parseResult.ok) {
    if (parseResult.kind === 'none') {
      return { status: 'ignored', reason: 'No Conduit request found.' };
    }
    const repair = createRepairEnvelope({
      reason: parseResult.error ?? `Request parse failed: ${parseResult.kind}.`,
      code: parseResult.kind === 'multiple' ? 'multiple_envelopes' : classifyRepairCode(parseResult.error),
    });
    return {
      status: 'rejected',
      reason: repair.reason,
      repair,
      rendered: renderConduitRepair(repair)
    };
  }

  return executeConduitRequest(parseResult.block, {
    yes: input.yes,
    confirm: input.confirm
  });
}

export async function executeConduitRequest(
  request: ActionRequestBlock,
  options: Pick<ExecuteRequestInput, 'yes' | 'confirm'> = {}
): Promise<ExecuteRequestOutput> {
  if (!request.sessionId || !request.nonce) {
    const repair = createRepairEnvelope({
      reason: 'Trusted execution requires sessionId and nonce.',
      code: 'missing_session',
      request
    });
    return {
      status: 'rejected',
      reason: repair.reason,
      repair,
      rendered: renderConduitRepair(repair)
    };
  }

  const validation = await validateSessionNonce(request.sessionId, request.nonce);
  if (!validation.ok) {
    const repair = createRepairEnvelope({
      reason: validation.reason,
      code: 'invalid_session',
      request,
      sessionId: request.sessionId
    });
    return {
      status: 'rejected',
      sessionId: request.sessionId,
      reason: repair.reason,
      repair,
      rendered: renderConduitRepair(repair)
    };
  }

  const session = validation.session;
  const projectRoot = await resolveProjectRoot(session.allowedRoots);
  const runId = createRunId();
  const runDir = getRunDir(runId);

  await ensureRunDir(runDir);
  await writeTextFile(runDir, 'request.json', `${JSON.stringify(request, null, 2)}\n`);
  await writeTextFile(runDir, 'metadata.json', `${JSON.stringify({
    runId,
    sessionId: session.sessionId,
    projectRoot,
    mode: 'request',
    startedAt: new Date().toISOString()
  }, null, 2)}\n`);

  const consumedSession = await consumeSessionNonce(request.sessionId, request.nonce);
  const results = await executeActions({
    actions: request.actions,
    projectRoot,
    runId,
    runDir,
    turn: 1,
    yes: options.yes,
    confirm: options.confirm,
    policySession: consumedSession
  });
  const status = summarizeResults(results);
  const rendered = renderConduitResults({
    type: 'conduit.results.v1',
    runId,
    sessionId: consumedSession.sessionId,
    nextNonce: consumedSession.currentNonce,
    results,
    status
  });
  await writeTextFile(runDir, 'result.txt', rendered);

  return {
    status: 'executed',
    runId,
    runDir,
    sessionId: consumedSession.sessionId,
    nextNonce: consumedSession.currentNonce,
    results,
    rendered
  };
}


async function resolveProjectRoot(allowedRoots: string[]): Promise<string> {
  const firstRoot = allowedRoots[0];
  if (!firstRoot) {
    throw new Error('Session has no allowed roots.');
  }
  return realpath(path.resolve(firstRoot));
}

function summarizeResults(results: ToolResult[]): 'ok' | 'partial' | 'denied' | 'error' {
  if (results.every((result) => result.status === 'ok')) {
    return 'ok';
  }
  if (results.every((result) => result.status === 'denied' || result.status === 'requires_confirmation')) {
    return 'denied';
  }
  if (results.some((result) => result.status === 'error')) {
    return 'error';
  }
  return 'partial';
}

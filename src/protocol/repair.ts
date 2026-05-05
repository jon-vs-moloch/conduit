import type { ActionRequestBlock } from './schemas.js';
import type { ConduitRepairEnvelope } from './render-results.js';

export function classifyRepairCode(error: string | undefined): ConduitRepairEnvelope['code'] {
  const text = error ?? '';
  if (text.includes('JSON') || text.includes('Unexpected') || text.includes('Duplicate JSON object key')) {
    return 'malformed_json';
  }
  if (text.includes('schema')) {
    return 'invalid_schema';
  }
  if (text.includes('permissions')) {
    return 'invalid_permissions';
  }
  return 'request_rejected';
}

export function createRepairEnvelope(input: {
  reason: string;
  code: ConduitRepairEnvelope['code'];
  request?: Partial<ActionRequestBlock>;
  sessionId?: string;
  currentNonce?: string;
}): ConduitRepairEnvelope {
  const sessionId = input.sessionId ?? input.request?.sessionId ?? 'sess_...';
  const nonce = input.currentNonce ?? input.request?.nonce ?? 'call_...';
  return {
    type: 'conduit.repair.v1',
    status: 'rejected',
    reason: input.reason,
    code: input.code,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.currentNonce ? { currentNonce: input.currentNonce } : {}),
    expected: {
      exactEnvelope: true,
      schema: 'conduit.request.v1',
      requiredFields: ['schema', 'source', 'permissions', 'sessionId', 'nonce', 'actions'],
      allowedClipboardForms: [
        'A single fenced ```conduit code block containing strict JSON.',
        'A single fenced ```conduit-json code block containing strict JSON.',
        'A single raw JSON Conduit request object.'
      ]
    },
    repairInstructions: [
      'Emit exactly one fenced ```conduit code block containing the repaired request JSON, with no surrounding prose inside the block.',
      'Use strict JSON: no comments, trailing commas, duplicate object keys, or markdown inside the JSON.',
      'Include schema: conduit.request.v1.',
      'Include source metadata and declared permissions, even when permissions is an empty array.',
      'Include the current sessionId and currentNonce from this repair envelope when present.',
      'Give every action a stable id.'
    ],
    example: {
      schema: 'conduit.request.v1',
      source: {
        kind: 'clipboard',
        trust: 'untrusted'
      },
      permissions: [
        {
          kind: 'filesystem',
          scope: 'project',
          access: 'read'
        }
      ],
      sessionId,
      nonce,
      actions: [
        {
          id: 'list_project',
          tool: 'file.list',
          args: { path: '.' },
          reason: 'List the project root.',
          risk: 'low'
        }
      ]
    }
  };
}

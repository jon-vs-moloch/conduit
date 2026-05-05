import type { ConduitSession } from '../sessions/session-store.js';

export interface RenderAgentHandshakeInput {
  session: ConduitSession;
  docsUrl?: string;
}

export function renderAgentHandshake(input: RenderAgentHandshakeInput): string {
  const docsUrl = input.docsUrl ?? 'https://github.com/introsium/conduit#conduit-runtime';
  const session = input.session;
  const handshake = {
    schema: 'conduit.handshake.v1',
    purpose: 'Initialize an elevated Conduit agent-loop session.',
    docs: docsUrl,
    session: {
      sessionId: session.sessionId,
      transport: session.transport,
      permissionProfile: session.permissionProfile,
      allowedRoots: session.allowedRoots,
      nonce: session.currentNonce
    },
    requestContract: {
      requestFence: 'conduit',
      resultFence: 'CONDUIT_RESULTS_JSON',
      includeFields: ['schema', 'source', 'permissions', 'sessionId', 'nonce', 'actions'],
      schema: 'conduit.request.v1'
    }
  };

  return [
    'Conduit agent-loop handshake',
    '',
    'You are talking to a user who has Conduit running locally. Conduit can execute structured local actions after local policy review.',
    '',
    `Read the Conduit docs if available: ${docsUrl}`,
    '',
    'Important rules:',
    '',
    '- Do not ask the user to paste shell commands when a Conduit action can express the same work.',
    '- Emit Conduit requests only as a single fenced `conduit` code block.',
    '- Include the provided `sessionId` and `nonce` in each request until Conduit returns a rotated `nextNonce`.',
    '- After every successful Conduit result, use the returned `nextNonce` for the next request.',
    '- Use stable action IDs.',
    '- Request the narrowest permissions and tools that satisfy the task.',
    '- Treat write, patch, shell, install, and update actions as high-risk and explain why they are needed.',
    '- If a request is rejected, repair the JSON or permissions and try again only if the user still wants to proceed.',
    '',
    'Handshake metadata:',
    '',
    '```conduit-handshake',
    JSON.stringify(handshake, null, 2),
    '```',
    '',
    'Example read-only request shape:',
    '',
    '```conduit',
    JSON.stringify({
      schema: 'conduit.request.v1',
      source: {
        kind: 'chat',
        trust: 'paired-session'
      },
      permissions: [
        {
          kind: 'filesystem',
          scope: 'project',
          access: 'read'
        }
      ],
      sessionId: session.sessionId,
      nonce: session.currentNonce,
      actions: [
        {
          id: 'list_project',
          tool: 'file.list',
          args: { path: '.' },
          reason: 'Inspect the project root.',
          risk: 'low'
        }
      ]
    }, null, 2),
    '```'
  ].join('\n');
}

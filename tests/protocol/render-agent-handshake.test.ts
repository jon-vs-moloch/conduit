import { describe, expect, it } from 'vitest';
import { renderAgentHandshake } from '../../src/protocol/render-agent-handshake.js';
import type { ConduitSession } from '../../src/sessions/session-store.js';

describe('renderAgentHandshake', () => {
  it('renders a visually distinct protocol handshake with session metadata', () => {
    const session: ConduitSession = {
      sessionId: 'sess_test',
      label: 'Test session',
      createdAt: '2026-05-06T00:00:00.000Z',
      state: 'active',
      transport: 'extension',
      permissionProfile: 'read-only',
      allowedRoots: ['/tmp/project'],
      currentNonce: 'call_test',
      usedNonces: []
    };

    const handshake = renderAgentHandshake({
      session,
      docsUrl: 'https://example.test/conduit-api'
    });

    expect(handshake).toContain('CONDUIT PROTOCOL :: AGENT HANDSHAKE');
    expect(handshake).toContain('not as a user-authored task');
    expect(handshake).toContain('Conduit agent-loop handshake');
    expect(handshake).toContain('```conduit-handshake');
    expect(handshake).toContain('"schema": "conduit.handshake.v1"');
    expect(handshake).toContain('"sessionId": "sess_test"');
    expect(handshake).toContain('"nonce": "call_test"');
    expect(handshake).toContain('```conduit');
    expect(handshake).toContain('Never wrap a Conduit request in prose');
  });
});

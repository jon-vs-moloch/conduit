import { describe, expect, it } from 'vitest';
import { extractProtocolBlocks } from '../../src/protocol/extract-protocol-blocks.js';

describe('extractProtocolBlocks', () => {
  it('extracts native conduit request blocks', () => {
    const blocks = extractProtocolBlocks([
      '```conduit',
      '{ "type": "conduit.request.v1", "actions": [{ "id": "read", "tool": "file.read", "args": { "path": "README.md" } }] }',
      '```'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit');
    expect(blocks[0]?.jsonText).toContain('conduit.request.v1');
  });

  it('extracts named protocol blocks without normal prose', () => {
    const blocks = extractProtocolBlocks([
      'Normal assistant answer before the tool request.',
      '',
      '```conduit-call',
      '{ "type": "actions", "actions": [{ "id": "read", "tool": "file.read", "args": { "path": "README.md" } }] }',
      '```',
      '',
      'Normal assistant answer after the tool request.'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit-call');
    expect(blocks[0]?.text).toContain('```conduit-call');
    expect(blocks[0]?.jsonText).toContain('"actions"');
  });

  it('extracts json-prefixed named blocks', () => {
    const blocks = extractProtocolBlocks([
      '```json conduit-final',
      '{ "status": "complete", "summary": "Done." }',
      '```'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit-final');
  });

  it('extracts agent-initiated handshake request blocks', () => {
    const blocks = extractProtocolBlocks([
      '```conduit-handshake-request',
      '{ "schema": "conduit.handshake.request.v1", "reason": "Need local context." }',
      '```'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit-handshake-request');
    expect(blocks[0]?.jsonText).toContain('conduit.handshake.request.v1');
  });

  it('extracts legacy delimiter blocks for compatibility', () => {
    const blocks = extractProtocolBlocks([
      '<<<ACTIONS_JSON',
      '{ "actions": [{ "id": "read", "tool": "file.read", "args": { "path": "README.md" } }] }',
      'ACTIONS_JSON>>>'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('legacy-actions');
  });

  it('extracts rendered ChatGPT code block text without markdown fences', () => {
    const blocks = extractProtocolBlocks([
      'Thought for a couple of seconds',
      '',
      'conduit-call',
      'Copy',
      '{ "type": "actions", "actions": [{ "id": "read_readme", "tool": "file.read", "args": { "path": "README.md" }, "reason": "Need context.", "risk": "low" }] }'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit-call');
    expect(blocks[0]?.text).toContain('```conduit-call');
    expect(blocks[0]?.jsonText).toContain('read_readme');
  });

  it('extracts rendered plain conduit request blocks without markdown fences', () => {
    const blocks = extractProtocolBlocks([
      'Thought for a couple of seconds',
      '',
      'conduit',
      'Copy',
      '{ "schema": "conduit.request.v1", "source": { "kind": "chat", "trust": "paired-session" }, "permissions": [], "sessionId": "sess_test", "nonce": "call_test", "actions": [{ "id": "read_readme", "tool": "file.read", "args": { "path": "README.md" }, "reason": "Need context.", "risk": "low" }] }'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('conduit');
    expect(blocks[0]?.text).toContain('```conduit');
    expect(blocks[0]?.jsonText).toContain('sess_test');
  });

  it('extracts legacy veyr named blocks during migration', () => {
    const blocks = extractProtocolBlocks([
      '```veyr-call',
      '{ "type": "actions", "actions": [{ "id": "read", "tool": "file.read", "args": { "path": "README.md" } }] }',
      '```'
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('veyr-call');
  });
});

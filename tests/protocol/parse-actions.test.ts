import { describe, expect, it } from 'vitest';
import { ACTIONS_END, ACTIONS_START } from '../../src/protocol/delimiters.js';
import { parseActions } from '../../src/protocol/parse-actions.js';

describe('parseActions', () => {
  it('parses a native conduit.request.v1 block', () => {
    const result = parseActions([
      '```conduit',
      JSON.stringify({
        type: 'conduit.request.v1',
        sessionId: 'sess_test',
        nonce: 'call_test',
        title: 'Read project context',
        requestedCapabilities: ['file.read'],
        actions: [
          {
            id: 'read_readme',
            tool: 'file.read',
            args: { path: 'README.md' },
            reason: 'Need project context.',
            risk: 'low'
          }
        ],
        resultMode: {
          transport: 'clipboard',
          format: 'json'
        }
      }, null, 2),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.type).toBe('conduit.request.v1');
      expect(result.block.sessionId).toBe('sess_test');
      expect(result.block.actions[0]?.tool).toBe('file.read');
    }
  });

  it('parses a conduit-call code block while preserving normal prose', () => {
    const result = parseActions([
      'Sure, I can inspect that first.',
      '',
      '```conduit-call',
      JSON.stringify({
        type: 'actions',
        actions: [
          {
            id: 'read_readme',
            tool: 'file.read',
            args: { path: 'README.md' },
            reason: 'Need project context.',
            risk: 'low'
          }
        ]
      }, null, 2),
      '```',
      '',
      'I will continue after the harness responds.'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.type).toBe('actions');
      expect(result.block.actions[0]?.tool).toBe('file.read');
    }
  });

  it('parses a legacy veyr-call code block for migration compatibility', () => {
    const result = parseActions([
      '```veyr-call',
      '{"type":"actions","actions":[{"id":"read","tool":"file.read","args":{"path":"README.md"}}]}',
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.actions[0]?.id).toBe('read');
    }
  });

  it('parses one valid action block and ignores surrounding prose', () => {
    const result = parseActions([
      'I need to inspect the project.',
      ACTIONS_START,
      JSON.stringify({
        actions: [
          {
            id: 'read_readme',
            tool: 'file.read',
            args: { path: 'README.md' },
            reason: 'Need project context.',
            risk: 'low'
          }
        ]
      }),
      ACTIONS_END
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.actions[0]?.tool).toBe('file.read');
    }
  });

  it('returns none when no block exists', () => {
    expect(parseActions('plain prose')).toEqual({ ok: false, kind: 'none' });
  });

  it('rejects multiple action blocks', () => {
    const block = '```conduit-call\n{"type":"actions","actions":[{"id":"a","tool":"file.read","args":{"path":"README.md"}}]}\n```';
    const result = parseActions(`${block}\n${block}`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('multiple');
    }
  });

  it('rejects output with both conduit-call and legacy action blocks', () => {
    const result = parseActions([
      '```conduit-call',
      '{"type":"actions","actions":[{"id":"a","tool":"file.read","args":{"path":"README.md"}}]}',
      '```',
      ACTIONS_START,
      '{"actions":[{"id":"b","tool":"file.read","args":{"path":"README.md"}}]}',
      ACTIONS_END
    ].join('\n'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('multiple');
    }
  });

  it('rejects duplicate action ids', () => {
    const result = parseActions([
      ACTIONS_START,
      JSON.stringify({
        actions: [
          { id: 'same', tool: 'file.read', args: { path: 'README.md' } },
          { id: 'same', tool: 'file.read', args: { path: 'README.md' } }
        ]
      }),
      ACTIONS_END
    ].join('\n'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
    }
  });
});

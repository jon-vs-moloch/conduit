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

  it('normalizes a compact single-action conduit request', () => {
    const result = parseActions([
      '```conduit',
      JSON.stringify({
        schema: 'conduit.request.v1',
        sessionId: 'sess_test',
        nonce: 'call_test',
        read: 'README.md',
        reason: 'Need project context.',
        risk: 'low'
      }, null, 2),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.actions).toHaveLength(1);
      expect(result.block.actions[0]).toMatchObject({
        tool: 'file.read',
        args: { path: 'README.md' },
        reason: 'Need project context.',
        risk: 'low'
      });
      expect(result.block.actions[0]?.id).toMatch(/^file_read_[a-f0-9]{8}$/);
    }
  });

  it('normalizes compact multi-action arrays with deterministic ids', () => {
    const text = [
      '```conduit',
      JSON.stringify({
        schema: 'conduit.request.v1',
        sessionId: 'sess_test',
        nonce: 'call_test',
        actions: [
          { list: '.', depth: 1 },
          { action: 'diff', path: 'README.md' },
          { tool: 'git.status' }
        ]
      }, null, 2),
      '```'
    ].join('\n');
    const result = parseActions(text);
    const secondResult = parseActions(text);

    expect(result.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (result.ok && secondResult.ok) {
      expect(result.block.actions.map((action) => action.tool)).toEqual([
        'file.list',
        'git.diff',
        'git.status'
      ]);
      expect(result.block.actions[0]?.args).toEqual({ path: '.', depth: 1 });
      expect(result.block.actions[1]?.args).toEqual({ path: 'README.md' });
      expect(result.block.actions[2]?.args).toEqual({});
      expect(result.block.actions.map((action) => action.id)).toEqual(
        secondResult.block.actions.map((action) => action.id)
      );
    }
  });

  it('normalizes small-model-friendly action aliases', () => {
    const result = parseActions([
      '```conduit',
      JSON.stringify({
        v: '1',
        session: 'sess_test',
        n: 'call_test',
        do: 'list',
        path: '.',
        reason: 'Look around.',
        risk: 'low'
      }, null, 2),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.schema).toBe('conduit.request.v1');
      expect(result.block.sessionId).toBe('sess_test');
      expect(result.block.nonce).toBe('call_test');
      expect(result.block.actions[0]).toMatchObject({
        tool: 'file.list',
        args: { path: '.' },
        reason: 'Look around.',
        risk: 'low'
      });
    }
  });

  it('normalizes string action shortcuts', () => {
    const result = parseActions([
      '```conduit',
      JSON.stringify({
        schema: 'conduit.request.v1',
        sessionId: 'sess_test',
        nonce: 'call_test',
        actions: [
          'list .',
          'read README.md',
          'status'
        ]
      }, null, 2),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.actions.map((action) => action.tool)).toEqual([
        'file.list',
        'file.read',
        'git.status'
      ]);
      expect(result.block.actions[0]?.args).toEqual({ path: '.' });
      expect(result.block.actions[1]?.args).toEqual({ path: 'README.md' });
      expect(result.block.actions[2]?.args).toEqual({});
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

import { describe, expect, it } from 'vitest';
import { parseClipboardEnvelope } from '../../src/protocol/parse-clipboard-envelope.js';

describe('parseClipboardEnvelope', () => {
  it('accepts exactly one fenced conduit envelope', () => {
    const result = parseClipboardEnvelope([
      '```conduit',
      JSON.stringify(validRequest()),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
  });

  it('accepts exactly one raw JSON envelope', () => {
    const result = parseClipboardEnvelope(JSON.stringify(validRequest()));

    expect(result.ok).toBe(true);
  });

  it('rejects prose wrapped around a valid envelope', () => {
    const result = parseClipboardEnvelope([
      'Here is the command you should run:',
      '',
      '```conduit',
      JSON.stringify(validRequest()),
      '```',
      '',
      'Thanks!'
    ].join('\n'));

    expect(result).toEqual({ ok: false, kind: 'none' });
  });

  it('rejects multiple envelopes', () => {
    const block = [
      '```conduit',
      JSON.stringify(validRequest()),
      '```'
    ].join('\n');
    const result = parseClipboardEnvelope(`${block}\n\n${block}`);

    expect(result).toEqual({
      ok: false,
      kind: 'multiple',
      error: 'Clipboard contains multiple Conduit envelopes.'
    });
  });

  it('rejects missing required clipboard metadata', () => {
    const result = parseClipboardEnvelope([
      '```conduit',
      JSON.stringify({
        schema: 'conduit.request.v1',
        actions: [{ id: 'read', tool: 'file.read', args: { path: 'README.md' } }]
      }),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
      expect(result.error).toContain('source');
    }
  });

  it('rejects duplicate JSON object keys before parsing', () => {
    const result = parseClipboardEnvelope([
      '```conduit',
      [
        '{',
        '"schema":"conduit.request.v1",',
        '"source":{"kind":"clipboard"},',
        '"permissions":[],',
        '"actions":[],',
        '"actions":[]',
        '}'
      ].join(''),
      '```'
    ].join('\n'));

    expect(result).toEqual({
      ok: false,
      kind: 'malformed',
      error: 'Duplicate JSON object key: actions'
    });
  });

  it('enforces maximum envelope size', () => {
    const result = parseClipboardEnvelope(JSON.stringify(validRequest()), { maxBytes: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('maximum size');
    }
  });
});

function validRequest(): unknown {
  return {
    schema: 'conduit.request.v1',
    source: {
      kind: 'clipboard',
      trust: 'untrusted'
    },
    permissions: [],
    sessionId: 'sess_test',
    nonce: 'call_test',
    actions: [
      {
        id: 'read',
        tool: 'file.read',
        args: { path: 'README.md' }
      }
    ]
  };
}

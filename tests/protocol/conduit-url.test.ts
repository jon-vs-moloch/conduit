import { describe, expect, it } from 'vitest';
import { createConduitUrl, parseConduitUrl } from '../../src/protocol/conduit-url.js';

describe('conduit URL helpers', () => {
  it('round-trips request JSON through a base64url payload', () => {
    const text = JSON.stringify({
      schema: 'conduit.request.v1',
      source: { kind: 'conduit-link', trust: 'untrusted' },
      permissions: [],
      actions: [
        { id: 'about', tool: 'conduit.about', args: {} }
      ]
    });

    const url = createConduitUrl(text);
    expect(url).toMatch(/^conduit:\/\/run\?payload=/);
    expect(url).not.toContain('{');

    expect(parseConduitUrl(url)).toEqual({
      command: 'run',
      text
    });
  });

  it('rejects non-Conduit schemes and missing payloads', () => {
    expect(() => parseConduitUrl('https://example.test/?payload=abc')).toThrow('conduit://');
    expect(() => parseConduitUrl('conduit://run')).toThrow('missing a payload');
  });
});

import { describe, expect, it } from 'vitest';
import { FINAL_END, FINAL_START } from '../../src/protocol/delimiters.js';
import { parseFinal } from '../../src/protocol/parse-final.js';

describe('parseFinal', () => {
  it('parses a conduit-final code block while ignoring prose', () => {
    const result = parseFinal([
      'Here is the summary.',
      '',
      '```conduit-final',
      JSON.stringify({
        status: 'complete',
        summary: 'Done.'
      }, null, 2),
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.summary).toBe('Done.');
    }
  });

  it('parses a legacy veyr-final code block for migration compatibility', () => {
    const result = parseFinal([
      '```veyr-final',
      '{"status":"complete","summary":"Legacy done."}',
      '```'
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.summary).toBe('Legacy done.');
    }
  });

  it('parses a valid final block', () => {
    const result = parseFinal([
      FINAL_START,
      JSON.stringify({
        status: 'complete',
        summary: 'Done.'
      }),
      FINAL_END
    ].join('\n'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block.summary).toBe('Done.');
    }
  });

  it('rejects an invalid final status', () => {
    const result = parseFinal([
      FINAL_START,
      JSON.stringify({
        status: 'mysterious',
        summary: 'Nope.'
      }),
      FINAL_END
    ].join('\n'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { renderToolResults } from '../../src/protocol/render-results.js';

describe('renderToolResults', () => {
  it('preserves valid JSON while compacting oversized string content', () => {
    const rendered = renderToolResults([
      {
        id: 'big_read',
        tool: 'file.read',
        status: 'ok',
        content: 'x'.repeat(20_000),
        metadata: { relativePath: 'large.md' }
      }
    ], { maxRenderedChars: 5_000 });

    expect(rendered.length).toBeLessThan(5_500);
    expect(rendered).toContain('Conduit transport truncated this tool result');
    expect(rendered).toContain('"conduitTransportTruncated": true');

    const json = rendered.match(/<<<TOOL_RESULTS_JSON\n([\s\S]+)\nTOOL_RESULTS_JSON>>>/)?.[1];
    expect(json).toBeTruthy();
    expect(() => JSON.parse(json!)).not.toThrow();
  });
});

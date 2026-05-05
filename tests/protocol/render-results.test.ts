import { describe, expect, it } from 'vitest';
import { renderConduitRepair, renderToolResults } from '../../src/protocol/render-results.js';

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

describe('renderConduitRepair', () => {
  it('renders a machine-readable repair envelope', () => {
    const rendered = renderConduitRepair({
      type: 'conduit.repair.v1',
      status: 'rejected',
      reason: 'Invalid JSON.',
      code: 'malformed_json',
      expected: {
        exactEnvelope: true,
        schema: 'conduit.request.v1',
        requiredFields: ['schema', 'source', 'permissions', 'sessionId', 'nonce', 'actions'],
        allowedClipboardForms: ['A single fenced ```conduit code block containing strict JSON.']
      },
      repairInstructions: ['Copy only the repaired Conduit envelope.'],
      example: {
        schema: 'conduit.request.v1',
        source: { kind: 'clipboard', trust: 'untrusted' },
        permissions: [],
        sessionId: 'sess_...',
        nonce: 'call_...',
        actions: []
      }
    });

    expect(rendered).toContain('<<<CONDUIT_REPAIR_JSON');
    expect(rendered).toContain('"type": "conduit.repair.v1"');

    const json = rendered.match(/<<<CONDUIT_REPAIR_JSON\n([\s\S]+)\nCONDUIT_REPAIR_JSON>>>/)?.[1];
    expect(json).toBeTruthy();
    expect(JSON.parse(json!)).toMatchObject({
      type: 'conduit.repair.v1',
      status: 'rejected',
      code: 'malformed_json'
    });
  });
});

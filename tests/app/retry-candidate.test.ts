import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderAppJs } from '../../src/app/control-panel.js';

describe('bridge retry candidate selection', () => {
  it('uses attention before retrying before pending in the extension popup', async () => {
    const script = await readFile(path.resolve('extension/popup.js'), 'utf8');
    const selectRetryTransportId = extractSelector(script);

    assertRetryPriority(selectRetryTransportId);
  });

  it('uses attention before retrying before pending in the control panel', () => {
    const selectRetryTransportId = extractSelector(renderAppJs());

    assertRetryPriority(selectRetryTransportId);
  });
});

function assertRetryPriority(selectRetryTransportId: (health: any) => string | undefined): void {
  expect(selectRetryTransportId({
    attentionOutboundIds: ['attention-1', 'attention-2'],
    retryingOutboundIds: ['retrying-1'],
    pendingSendResultIds: ['pending-1']
  })).toBe('attention-1');

  expect(selectRetryTransportId({
    attentionOutboundIds: [],
    retryingOutboundIds: ['retrying-1', 'retrying-2'],
    pendingSendResultIds: ['pending-1']
  })).toBe('retrying-1');

  expect(selectRetryTransportId({
    retryingOutboundIds: [],
    pendingSendResultIds: ['pending-1', 'pending-2']
  })).toBe('pending-1');

  expect(selectRetryTransportId({})).toBeUndefined();
  expect(selectRetryTransportId(null)).toBeUndefined();
}

function extractSelector(script: string): (health: any) => string | undefined {
  const match = script.match(/function selectRetryTransportId\([^)]*\) \{\n(?:.*\n)*?\}/);
  if (!match) throw new Error('selectRetryTransportId helper not found');

  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(`${match[0]}\nmodule.exports = selectRetryTransportId;`, context);
  return (context.module as { exports: (health: any) => string | undefined }).exports;
}

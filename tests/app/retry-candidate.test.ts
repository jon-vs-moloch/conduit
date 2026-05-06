import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderAppJs } from '../../src/app/control-panel.js';

describe('bridge retry candidate selection', () => {
  it('uses attention before retrying before pending in the extension popup', async () => {
    const script = await readFile(path.resolve('extension/popup.js'), 'utf8');
    const { selectRetryTransportId } = extractHelpers(script, ['selectRetryTransportId']);

    assertRetryPriority(selectRetryTransportId);
  });

  it('uses attention before retrying before pending in the control panel', () => {
    const { selectRetryTransportId } = extractHelpers(renderAppJs(), ['selectRetryTransportId']);

    assertRetryPriority(selectRetryTransportId);
  });

  it('shows popup retry controls for retrying and pending outbound states', async () => {
    const script = await readFile(path.resolve('extension/popup.js'), 'utf8');
    const { bridgeCanRetry, retryPanelText } = extractHelpers(script, [
      'selectRetryTransportId',
      'bridgeCanRetry',
      'retryPanelText'
    ]);

    expect(bridgeCanRetry({
      attentionOutboundIds: [],
      retryingOutboundIds: ['retrying-1'],
      pendingSendResultIds: []
    })).toBe(true);
    expect(retryPanelText({
      retryingOutbound: 1,
      retryingOutboundIds: ['retrying-1']
    })).toContain('retrying-1: retry is scheduled');

    expect(bridgeCanRetry({
      pendingSendResultIds: ['pending-1']
    })).toBe(true);
    expect(retryPanelText({
      pendingSendResults: 1,
      pendingSendResultIds: ['pending-1']
    })).toContain('pending-1: send is in progress');

    expect(bridgeCanRetry({})).toBe(false);
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

function extractHelpers(script: string, names: string[]): Record<string, (health: any) => any> {
  const declarations = names.map((name) => {
    const match = script.match(new RegExp(`function ${name}\\([^)]*\\) \\{\\n(?:.*\\n)*?\\}`));
    if (!match) throw new Error(`${name} helper not found`);
    return match[0];
  }).join('\n');

  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(`${declarations}\nmodule.exports = { ${names.join(', ')} };`, context);
  return (context.module as { exports: Record<string, (health: any) => any> }).exports;
}

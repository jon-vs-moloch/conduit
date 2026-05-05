import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionTransport } from '../../src/transports/extension-transport.js';

describe('ExtensionTransport', () => {
  let transport: ExtensionTransport;

  beforeEach(async () => {
    transport = new ExtensionTransport({
      port: 0,
      sendResultTimeoutMs: 75,
      sendRetryDelaysMs: [10, 20]
    });
    await transport.open();
  });

  afterEach(async () => {
    await transport.close();
  });

  it('serves health state', async () => {
    const response = await fetch(`${transport.getBaseUrl()}/health`);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      deliveredOutboundCount: 0,
      receivedInboundCount: 0,
      pendingSendResults: 0,
      tabStatusCount: 0,
      lastTabStatus: null,
      lastOutboundAt: null,
      lastSendResult: null,
      lastTransportError: null
    });
  });

  it('records extension tab status heartbeats', async () => {
    await postJson(`${transport.getBaseUrl()}/api/conduit-tab-status`, {
      tabId: 42,
      url: 'https://chatgpt.com/c/test',
      status: 'content_script_alive',
      observedAt: '2026-05-05T00:00:00.000Z'
    });

    const response = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(response.json()).resolves.toMatchObject({
      tabStatusCount: 1,
      lastTabStatus: {
        tabId: 42,
        url: 'https://chatgpt.com/c/test',
        status: 'content_script_alive'
      }
    });
  });

  it('queues inbound protocol blocks that arrive before waitForAssistantTurn', async () => {
    const payload = [
      '```conduit-final',
      '{ "status": "complete", "summary": "Done." }',
      '```'
    ].join('\n');

    const response = await postJson(`${transport.getBaseUrl()}/api/conduit-call`, {
      payload,
      kind: 'conduit-final',
      key: 'final-1',
      observedAt: '2026-05-04T00:00:00.000Z'
    });

    expect(response.status).toBe('ok');
    await expect(transport.waitForAssistantTurn({ timeoutMs: 100 })).resolves.toMatchObject({
      text: payload,
      timestamp: '2026-05-04T00:00:00.000Z'
    });
  });

  it('ignores duplicate inbound protocol blocks by key', async () => {
    const payload = [
      '```conduit-final',
      '{ "status": "complete", "summary": "Done." }',
      '```'
    ].join('\n');

    await postJson(`${transport.getBaseUrl()}/api/conduit-call`, {
      payload,
      kind: 'conduit-final',
      key: 'same-key'
    });
    const duplicate = await postJson(`${transport.getBaseUrl()}/api/conduit-call`, {
      payload,
      kind: 'conduit-final',
      key: 'same-key'
    });

    expect(duplicate.status).toBe('duplicate_ignored');
  });

  it('delivers queued outbound messages to extension pollers', async () => {
    const send = transport.sendMessage('hello ChatGPT');

    const response = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const outbound = await response.json() as OutboundPollResponse;
    expect(outbound).toMatchObject({
      type: 'harness_message',
      transportId: 'out-1'
    });
    expect(outbound.message).toContain('Conduit transport id: out-1');
    expect(outbound.message).toContain('hello ChatGPT');

    await postJson(`${transport.getBaseUrl()}/api/conduit-send-result`, {
      transportId: outbound.transportId,
      status: 'sent'
    });
    await expect(send).resolves.toBeUndefined();

    const health = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(health.json()).resolves.toMatchObject({
      deliveredOutboundCount: 1
    });
  });

  it('keeps listening after outbound delivery even before send confirmation', async () => {
    const send = transport.sendMessage('hello ChatGPT');

    const response = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const outbound = await response.json() as OutboundPollResponse;
    expect(outbound.transportId).toBe('out-1');
    await expect(send).resolves.toBeUndefined();

    const payload = [
      '```conduit-final',
      '{ "status": "complete", "summary": "Done." }',
      '```'
    ].join('\n');
    await postJson(`${transport.getBaseUrl()}/api/conduit-call`, {
      payload,
      kind: 'conduit-final',
      key: 'final-after-outbound'
    });

    await expect(transport.waitForAssistantTurn({ timeoutMs: 100 })).resolves.toMatchObject({
      text: payload
    });

    const health = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(health.json()).resolves.toMatchObject({
      pendingSendResults: 1,
      pendingSendResultIds: [outbound.transportId]
    });
  });

  it('requeues failed sends with daemon-side backoff', async () => {
    const send = transport.sendMessage('hello ChatGPT');

    const response = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const outbound = await response.json() as OutboundPollResponse;
    await expect(send).resolves.toBeUndefined();

    await postJson(`${transport.getBaseUrl()}/api/conduit-send-result`, {
      transportId: outbound.transportId,
      status: 'failed',
      error: 'Timed out waiting for send button'
    });

    const health = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(health.json()).resolves.toMatchObject({
      pendingSendResults: 0,
      retryingOutbound: 1,
      retryingOutboundIds: [outbound.transportId],
      lastTransportError: {
        transportId: outbound.transportId,
        status: 'failed',
        error: 'Timed out waiting for send button',
        retrying: true
      }
    });

    await delay(20);
    const retryResponse = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const retry = await retryResponse.json() as OutboundPollResponse;
    expect(retry).toMatchObject({
      transportId: outbound.transportId,
      message: outbound.message
    });
  });

  it('marks outbound sends as needing attention after retries are exhausted', async () => {
    const send = transport.sendMessage('hello ChatGPT');

    const firstResponse = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const first = await firstResponse.json() as OutboundPollResponse;
    await expect(send).resolves.toBeUndefined();

    for (const error of ['Composer not ready', 'Send button unavailable', 'Still broken']) {
      await postJson(`${transport.getBaseUrl()}/api/conduit-send-result`, {
        transportId: first.transportId,
        status: 'failed',
        error
      });
      await delay(25);
      const health = await fetch(`${transport.getBaseUrl()}/health`);
      const state = await health.json() as any;
      if (!state.lastTransportError?.exhausted) {
        await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
      }
    }

    const health = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(health.json()).resolves.toMatchObject({
      retryingOutbound: 0,
      lastTransportError: {
        transportId: first.transportId,
        status: 'failed',
        exhausted: true,
        needsAttention: true,
        deliveryAttempts: 3
      }
    });
  });
});

interface OutboundPollResponse {
  type: string;
  transportId: string;
  message: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  expect(response.ok).toBe(true);
  return response.json();
}

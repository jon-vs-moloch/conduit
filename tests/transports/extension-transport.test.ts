import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionTransport } from '../../src/transports/extension-transport.js';

describe('ExtensionTransport', () => {
  let transport: ExtensionTransport;

  beforeEach(async () => {
    transport = new ExtensionTransport({ port: 0 });
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

  it('rejects sendMessage when extension reports a failed send', async () => {
    const send = transport.sendMessage('hello ChatGPT');
    const handledSend = send.then(
      () => null,
      (error: unknown) => error
    );

    const response = await fetch(`${transport.getBaseUrl()}/api/conduit-outbound`);
    const outbound = await response.json() as OutboundPollResponse;
    await postJson(`${transport.getBaseUrl()}/api/conduit-send-result`, {
      transportId: outbound.transportId,
      status: 'failed',
      error: 'Timed out waiting for send button'
    });

    await expect(handledSend).resolves.toMatchObject({
      message: expect.stringMatching(/Timed out waiting for send button/)
    });

    const health = await fetch(`${transport.getBaseUrl()}/health`);
    await expect(health.json()).resolves.toMatchObject({
      lastTransportError: {
        transportId: outbound.transportId,
        status: 'failed',
        error: 'Timed out waiting for send button'
      }
    });
  });
});

interface OutboundPollResponse {
  type: string;
  transportId: string;
  message: string;
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

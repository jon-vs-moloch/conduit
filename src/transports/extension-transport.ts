import http from 'node:http';
import type { AssistantTurn, ModelTransport, WaitOptions } from './types.js';

const DEFAULT_PORT = 3333;

export interface ExtensionTransportOptions {
  port?: number;
}

interface IncomingExtensionPayload {
  payload?: unknown;
  kind?: unknown;
  key?: unknown;
  tabId?: unknown;
  url?: unknown;
  observedAt?: unknown;
}

interface OutboundDelivery {
  transportId: string;
  message: string;
  createdAt: string;
}

interface ExtensionSendResultPayload {
  transportId?: unknown;
  status?: unknown;
  error?: unknown;
  attempts?: unknown;
  deduped?: unknown;
  messageChars?: unknown;
  tabId?: unknown;
}

interface ExtensionTabStatusPayload {
  tabId?: unknown;
  url?: unknown;
  title?: unknown;
  status?: unknown;
  observedAt?: unknown;
}

export class ExtensionTransport implements ModelTransport {
  private server: http.Server | null = null;
  private outboundQueue: OutboundDelivery[] = [];
  private pendingOutboundResponses: http.ServerResponse[] = [];
  private inboundQueue: AssistantTurn[] = [];
  private pendingTurnResolve: ((turn: AssistantTurn) => void) | null = null;
  private pendingTurnReject: ((error: Error) => void) | null = null;
  private seenIncomingKeys = new Set<string>();
  private pendingSendResults = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private deliveredOutboundCount = 0;
  private receivedInboundCount = 0;
  private outboundCounter = 0;
  private lastOutboundAt: string | null = null;
  private lastSendResult: unknown = null;
  private tabStatusCount = 0;
  private lastTabStatus: unknown = null;

  constructor(private readonly options: ExtensionTransportOptions = {}) {}

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.once('error', (error) => {
        reject(error);
      });

      this.server.listen(this.options.port ?? DEFAULT_PORT, '127.0.0.1', () => {
        console.log('\n--- Extension Transport Started ---');
        console.log(`Listening for browser extension on ${this.getBaseUrl()}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const response of this.pendingOutboundResponses.splice(0)) {
      sendJson(response, 200, { message: null });
    }

    for (const [transportId, pending] of this.pendingSendResults) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Extension transport closed before outbound ${transportId} was sent.`));
    }
    this.pendingSendResults.clear();

    if (this.pendingTurnReject) {
      this.pendingTurnReject(new Error('Extension transport closed.'));
      this.pendingTurnReject = null;
      this.pendingTurnResolve = null;
    }

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        console.log('\n--- Extension Transport Stopped ---');
        resolve();
      });
      this.server = null;
    });
  }

  async ensureReady(): Promise<void> {
    console.log(`[ExtensionTransport] Waiting for the extension to poll ${this.getBaseUrl()}...`);
  }

  getBaseUrl(): string {
    const address = this.server?.address();
    const port = typeof address === 'object' && address ? address.port : (this.options.port ?? DEFAULT_PORT);
    return `http://127.0.0.1:${port}`;
  }

  async sendMessage(message: string): Promise<void> {
    const delivery = this.createOutboundDelivery(message);
    console.log(`[ExtensionTransport] outbound ${delivery.transportId} queued chars=${delivery.message.length}`);

    const sendResult = this.waitForSendResult(delivery.transportId);
    const pendingResponse = this.pendingOutboundResponses.shift();
    if (pendingResponse) {
      this.deliverOutbound(pendingResponse, delivery);
    } else {
      this.outboundQueue.push(delivery);
    }

    await sendResult;
  }

  async waitForAssistantTurn(options?: WaitOptions): Promise<AssistantTurn> {
    console.log('[ExtensionTransport] Waiting for protocol block from extension...');
    const queuedTurn = this.inboundQueue.shift();
    if (queuedTurn) {
      return queuedTurn;
    }

    return new Promise((resolve, reject) => {
      this.pendingTurnResolve = resolve;
      this.pendingTurnReject = reject;

      const timeoutMs = options?.timeoutMs ?? 300_000;
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.pendingTurnResolve === resolve) {
            this.pendingTurnResolve = null;
            this.pendingTurnReject = null;
            reject(new Error(`waitForAssistantTurn timed out after ${timeoutMs}ms.`));
          }
        }, timeoutMs);
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        outboundQueued: this.outboundQueue.length,
        inboundQueued: this.inboundQueue.length,
        pendingPolls: this.pendingOutboundResponses.length,
        deliveredOutboundCount: this.deliveredOutboundCount,
        receivedInboundCount: this.receivedInboundCount,
        tabStatusCount: this.tabStatusCount,
        lastTabStatus: this.lastTabStatus,
        lastOutboundAt: this.lastOutboundAt,
        lastSendResult: this.lastSendResult
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/conduit-outbound') {
      this.handleOutboundPoll(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/conduit-call') {
      await this.handleIncomingProtocolBlock(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/conduit-send-result') {
      const body = await readJsonBody(req).catch(() => null) as ExtensionSendResultPayload | null;
      this.lastSendResult = body;
      console.log('[ExtensionTransport] Send result from extension:', body);
      this.resolveSendResult(body);
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/conduit-tab-status') {
      const body = await readJsonBody(req).catch(() => null) as ExtensionTabStatusPayload | null;
      this.lastTabStatus = body;
      this.tabStatusCount += 1;
      console.log('[ExtensionTransport] Tab status from extension:', body);
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  private handleOutboundPoll(req: http.IncomingMessage, res: http.ServerResponse): void {
    const delivery = this.outboundQueue.shift();
    if (delivery !== undefined) {
      this.deliverOutbound(res, delivery);
      return;
    }

    this.pendingOutboundResponses.push(res);
    req.setTimeout(30_000, () => {
      const index = this.pendingOutboundResponses.indexOf(res);
      if (index !== -1) {
        this.pendingOutboundResponses.splice(index, 1);
        sendJson(res, 200, { message: null });
      }
    });
  }

  private async handleIncomingProtocolBlock(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let data: IncomingExtensionPayload;
    try {
      data = await readJsonBody(req) as IncomingExtensionPayload;
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (typeof data.payload !== 'string' || data.payload.trim() === '') {
      sendJson(res, 400, { error: 'Missing payload' });
      return;
    }

    const dedupeKey = typeof data.key === 'string'
      ? data.key
      : `${data.kind ?? 'unknown'}:${data.payload}`;
    if (this.seenIncomingKeys.has(dedupeKey)) {
      sendJson(res, 200, { status: 'duplicate_ignored' });
      return;
    }
    this.seenIncomingKeys.add(dedupeKey);

    const turn: AssistantTurn = {
      text: data.payload,
      timestamp: typeof data.observedAt === 'string' ? data.observedAt : new Date().toISOString()
    };

    console.log(`[ExtensionTransport] Received ${data.kind ?? 'protocol block'} from ChatGPT extension.`);
    this.receivedInboundCount += 1;
    if (this.pendingTurnResolve) {
      const resolve = this.pendingTurnResolve;
      this.pendingTurnResolve = null;
      this.pendingTurnReject = null;
      resolve(turn);
    } else {
      this.inboundQueue.push(turn);
    }

    sendJson(res, 200, { status: 'ok' });
  }

  private createOutboundDelivery(message: string): OutboundDelivery {
    const transportId = `out-${++this.outboundCounter}`;
    return {
      transportId,
      createdAt: new Date().toISOString(),
      message: [
        `Conduit transport id: ${transportId}`,
        '',
        message
      ].join('\n')
    };
  }

  private waitForSendResult(transportId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSendResults.delete(transportId);
        reject(new Error(`Timed out waiting for extension to confirm outbound ${transportId} was sent.`));
      }, 120_000);
      this.pendingSendResults.set(transportId, { resolve, reject, timeout });
    });
  }

  private resolveSendResult(body: ExtensionSendResultPayload | null): void {
    const transportId = typeof body?.transportId === 'string' ? body.transportId : null;
    if (!transportId) return;

    const pending = this.pendingSendResults.get(transportId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingSendResults.delete(transportId);

    if (body?.status === 'sent') {
      pending.resolve();
      return;
    }

    const error = typeof body?.error === 'string'
      ? body.error
      : `Extension failed to send outbound ${transportId}.`;
    pending.reject(new Error(error));
  }

  private deliverOutbound(res: http.ServerResponse, delivery: OutboundDelivery): void {
    this.deliveredOutboundCount += 1;
    this.lastOutboundAt = new Date().toISOString();
    console.log(`[ExtensionTransport] outbound ${delivery.transportId} delivered-to-extension chars=${delivery.message.length}`);
    sendJson(res, 200, {
      type: 'harness_message',
      transportId: delivery.transportId,
      createdAt: delivery.createdAt,
      message: delivery.message
    });
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

import { createHash } from 'node:crypto';
import { executeRequestFromText, type ExecuteRequestOutput } from './execute-request.js';
import type { ClipboardIO } from './clipboard-io.js';

export interface ClipboardWatcherOptions {
  clipboard: ClipboardIO;
  intervalMs?: number;
  yes?: boolean;
  onEvent?: (event: ClipboardWatcherEvent) => void;
}

export type ClipboardWatcherEvent =
  | { type: 'ignored'; reason: string }
  | { type: 'accepted'; runId?: string; sessionId?: string }
  | { type: 'rejected'; reason: string; sessionId?: string }
  | { type: 'executed'; runId: string; sessionId?: string }
  | { type: 'error'; error: string };

export interface ClipboardOnceResult {
  status: 'unchanged' | 'ignored' | 'rejected' | 'executed' | 'error';
  output?: ExecuteRequestOutput;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 1000;

export class ClipboardWatcher {
  private lastSeenHash: string | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ClipboardWatcherOptions) {}

  async checkOnce(): Promise<ClipboardOnceResult> {
    try {
      const text = await this.options.clipboard.read();
      const hash = hashText(text);
      if (hash === this.lastSeenHash) {
        return { status: 'unchanged' };
      }
      this.lastSeenHash = hash;

      const output = await executeRequestFromText({
        text,
        yes: this.options.yes
      });

      if (output.status === 'ignored') {
        this.emit({ type: 'ignored', reason: output.reason ?? 'No Conduit request found.' });
        return { status: 'ignored', output };
      }

      if (output.status === 'rejected') {
        const rendered = renderRejectedRequest(output.reason ?? 'Request rejected.', output.sessionId);
        await this.options.clipboard.write(rendered);
        this.lastSeenHash = hashText(rendered);
        this.emit({
          type: 'rejected',
          reason: output.reason ?? 'Request rejected.',
          sessionId: output.sessionId
        });
        return { status: 'rejected', output };
      }

      this.emit({ type: 'accepted', runId: output.runId, sessionId: output.sessionId });
      const working = renderWorkingStatus(output.runId, output.sessionId);
      await this.options.clipboard.write(working);
      this.lastSeenHash = hashText(working);

      if (output.rendered) {
        await this.options.clipboard.write(output.rendered);
        this.lastSeenHash = hashText(output.rendered);
      }

      this.emit({ type: 'executed', runId: output.runId!, sessionId: output.sessionId });
      return { status: 'executed', output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', error: message });
      return { status: 'error', error: message };
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const intervalMs = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const tick = async () => {
      if (!this.running) return;
      await this.checkOnce();
      if (this.running) {
        this.timer = setTimeout(tick, intervalMs);
      }
    };
    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(event: ClipboardWatcherEvent): void {
    this.options.onEvent?.(event);
  }
}

export function renderWorkingStatus(runId?: string, sessionId?: string): string {
  return [
    'Conduit is still working.',
    '',
    'The request was accepted and is executing.',
    'Paste again when the result is ready, or open Conduit to view progress.',
    '',
    ...(runId ? [`Run: ${runId}`] : []),
    ...(sessionId ? [`Session: ${sessionId}`] : [])
  ].join('\n');
}

export function renderRejectedRequest(reason: string, sessionId?: string): string {
  return [
    'Conduit request rejected.',
    '',
    reason,
    '',
    ...(sessionId ? [`Session: ${sessionId}`] : [])
  ].join('\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

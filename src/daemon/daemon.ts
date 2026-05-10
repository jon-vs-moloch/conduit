import { ClipboardWatcher, type ClipboardWatcherEvent } from './clipboard-watcher.js';
import { MacClipboardIO } from './clipboard-io.js';

export interface RunClipboardDaemonOptions {
  once?: boolean;
  intervalMs?: number;
  yes?: boolean;
}

export async function runClipboardDaemon(options: RunClipboardDaemonOptions = {}): Promise<void> {
  const watcher = new ClipboardWatcher({
    clipboard: new MacClipboardIO(),
    intervalMs: options.intervalMs,
    yes: options.yes,
    onEvent: logEvent
  });

  if (options.once) {
    const result = await watcher.checkOnce();
    if (result.status === 'unchanged') {
      console.log('[Conduit daemon] Clipboard unchanged.');
    }
    return;
  }

  console.log('[Conduit daemon] Clipboard watcher started. Press Ctrl+C to stop.');
  watcher.start();

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      watcher.stop();
      console.log('\n[Conduit daemon] Clipboard watcher stopped.');
      resolve();
    });
  });
}

function logEvent(event: ClipboardWatcherEvent): void {
  if (event.type === 'ignored') {
    return;
  }
  if (event.type === 'accepted') {
    console.log(`[Conduit daemon] Accepted request${event.runId ? ` run=${event.runId}` : ''}${event.sessionId ? ` session=${event.sessionId}` : ''}`);
    return;
  }
  if (event.type === 'executed') {
    console.log(`[Conduit daemon] Executed request run=${event.runId}${event.sessionId ? ` session=${event.sessionId}` : ''}`);
    return;
  }
  if (event.type === 'rejected') {
    console.log(`[Conduit daemon] Rejected request: ${event.reason}`);
    return;
  }
  if (event.type === 'requires_review') {
    console.log(`[Conduit daemon] Review required: ${event.reason}${event.approvalId ? ` approval=${event.approvalId}` : ''}`);
    return;
  }
  console.error(`[Conduit daemon] Error: ${event.error}`);
}

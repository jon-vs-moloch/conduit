import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import type { AssistantTurn, ModelTransport, WaitOptions } from './types.js';

const execFileAsync = promisify(execFile);

export class ClipboardTransport implements ModelTransport {
  private outboundCount = 0;
  private inboundCount = 0;

  async open(): Promise<void> {
    console.log('\n--- Clipboard Transport Started ---');
  }

  async close(): Promise<void> {
    console.log('\n--- Clipboard Transport Stopped ---');
  }

  async ensureReady(): Promise<void> {
    console.log([
      'Ready. Clipboard mode is manual and alternates directions:',
      '1. Conduit copies a message for you to paste into ChatGPT.',
      "2. You copy ChatGPT's full response, then return here and press ENTER."
    ].join('\n'));
  }

  async sendMessage(message: string): Promise<void> {
    await this.copyToClipboard(message);
    this.outboundCount += 1;
    console.log([
      '',
      `[Conduit -> ChatGPT ${this.outboundCount}] Copied a harness message to your clipboard.`,
      'Paste it into ChatGPT as the next user message and send it.',
      'Then wait for ChatGPT to answer. Do not copy this harness message back into Conduit.',
      '',
      formatTranscriptBlock('Conduit message copied to clipboard', message)
    ].join('\n'));
  }

  async waitForAssistantTurn(options?: WaitOptions): Promise<AssistantTurn> {
    this.inboundCount += 1;
    console.log([
      '',
      `[ChatGPT -> Conduit ${this.inboundCount}] Waiting for ChatGPT's response.`,
      "When ChatGPT finishes, copy only ChatGPT's full assistant response to your clipboard,",
      'then press ENTER here.'
    ].join('\n'));
    
    await this.waitForEnter();
    
    const text = await this.readFromClipboard();
    console.log([
      '',
      formatTranscriptBlock('ChatGPT response read from clipboard', text)
    ].join('\n'));
    return {
      text,
      timestamp: new Date().toISOString()
    };
  }

  private async copyToClipboard(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile('pbcopy', [], (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin?.write(text);
      child.stdin?.end();
    });
  }

  private async readFromClipboard(): Promise<string> {
    const { stdout } = await execFileAsync('pbpaste');
    return stdout;
  }

  private waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Press ENTER after copying ChatGPT response...', () => {
        rl.close();
        resolve();
      });
    });
  }
}

function formatTranscriptBlock(label: string, text: string): string {
  return [
    `--- ${label} ---`,
    text,
    `--- end ${label} ---`
  ].join('\n');
}

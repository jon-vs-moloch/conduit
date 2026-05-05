import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { END_TURN } from '../protocol/delimiters.js';
import { SELECTORS } from './chatgpt-selectors.js';
import type { AssistantTurn, ModelTransport, WaitOptions } from './types.js';

export type BrowserChannel = 'auto' | 'chromium' | 'chrome' | 'msedge';

export interface ChatGPTPlaywrightTransportOptions {
  channel?: BrowserChannel;
}

export class ChatGPTPlaywrightTransport implements ModelTransport {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly options: ChatGPTPlaywrightTransportOptions = {}) {}

  async open(): Promise<void> {
    const channel = resolveBrowserChannel(this.options.channel ?? getBrowserChannelFromEnv());
    const profileName = channel === 'chromium' ? 'chatgpt' : `chatgpt-${channel}`;
    const profilePath = path.join(os.homedir(), '.conduit', 'browser-profiles', profileName);
    this.context = await chromium.launchPersistentContext(profilePath, {
      ...(channel === 'chromium' ? {} : { channel }),
      headless: false,
      viewport: { width: 1280, height: 800 }
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  async ensureReady(): Promise<void> {
    if (!this.page) throw new Error('Transport not opened.');

    const url = this.page.url();
    if (!url.startsWith('https://chatgpt.com')) {
      await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    }

    try {
      await this.page.waitForSelector(SELECTORS.composer, { timeout: 30000 });
    } catch (e) {
      throw new Error('Composer not found. Are you logged in? Run `npm run login` from the repo, or build/link the CLI and run `conduit login`.');
    }
  }

  async openLoginPageAndWaitForClose(): Promise<void> {
    if (!this.page || !this.context) {
      throw new Error('Transport not opened.');
    }

    await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    await new Promise<void>((resolve) => {
      this.context?.once('close', () => resolve());
    });
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.page) throw new Error('Transport not opened.');

    const composer = await this.page.locator(SELECTORS.composer).first();
    await composer.focus();
    
    // Instead of typing which is slow and can trigger autocomplete bugs, try to fill or paste
    // Fill might not work perfectly on contenteditable. Try evaluate or focus+paste.
    await composer.fill(message);
    
    // We can also try dispatching an Enter if there's no send button, or clicking the send button.
    try {
      const sendButton = this.page.locator(SELECTORS.sendButton);
      await sendButton.waitFor({ state: 'visible', timeout: 2000 });
      await sendButton.click();
    } catch {
      await composer.press('Enter');
    }
    
    // Wait briefly for message to appear
    await this.page.waitForTimeout(500);
  }

  async waitForAssistantTurn(options?: WaitOptions): Promise<AssistantTurn> {
    if (!this.page) throw new Error('Transport not opened.');

    const timeoutMs = options?.timeoutMs ?? 180000;
    const quietMs = options?.quietMs ?? 2000;
    const sentinel = options?.sentinel ?? END_TURN;
    
    const startTime = Date.now();
    let lastText = '';
    let stableTime = 0;
    
    // Simple polling loop
    while (Date.now() - startTime < timeoutMs) {
      // Find the last assistant message
      const locators = await this.page.locator(SELECTORS.assistantMessage).all();
      if (locators.length > 0) {
        const lastMsg = locators[locators.length - 1];
        const text = (await lastMsg.innerText()) || '';
        
        if (text !== lastText) {
          lastText = text;
          stableTime = Date.now();
        } else if (text && text.includes(sentinel)) {
          // Found sentinel
          return {
            text,
            timestamp: new Date().toISOString()
          };
        } else if (text && Date.now() - stableTime > quietMs) {
          // Check if stop button is gone
          const stopButtons = await this.page.locator(SELECTORS.stopButton).count();
          if (stopButtons === 0) {
            // Probably done even without sentinel
            return {
              text,
              timestamp: new Date().toISOString()
            };
          }
        }
      }
      
      await this.page.waitForTimeout(500);
    }
    
    throw new Error(`waitForAssistantTurn timed out after ${timeoutMs}ms.`);
  }
}

function getBrowserChannelFromEnv(): BrowserChannel {
  const channel = process.env.CONDUIT_BROWSER_CHANNEL;
  if (channel === 'auto' || channel === 'chrome' || channel === 'msedge' || channel === 'chromium') {
    return channel;
  }

  return 'auto';
}

function resolveBrowserChannel(channel: BrowserChannel): Exclude<BrowserChannel, 'auto'> {
  if (channel !== 'auto') {
    return channel;
  }

  if (existsSync('/Applications/Google Chrome.app')) {
    return 'chrome';
  }

  if (existsSync('/Applications/Microsoft Edge.app')) {
    return 'msedge';
  }

  return 'chromium';
}

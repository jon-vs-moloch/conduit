import type { AssistantTurn, ModelTransport, WaitOptions } from './types.js';

export class FakeTransport implements ModelTransport {
  readonly sentMessages: string[] = [];
  private responseIndex = 0;

  constructor(private readonly scriptedResponses: string[]) {}

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  async ensureReady(): Promise<void> {}

  async sendMessage(message: string): Promise<void> {
    this.sentMessages.push(message);
  }

  async waitForAssistantTurn(_options?: WaitOptions): Promise<AssistantTurn> {
    const text = this.scriptedResponses[this.responseIndex];
    if (text === undefined) {
      throw new Error('FakeTransport has no scripted assistant responses remaining.');
    }

    this.responseIndex += 1;
    return {
      text,
      timestamp: new Date().toISOString()
    };
  }
}

export interface ModelTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  ensureReady(): Promise<void>;
  sendMessage(message: string): Promise<void>;
  waitForAssistantTurn(options?: WaitOptions): Promise<AssistantTurn>;
}

export interface AssistantTurn {
  text: string;
  rawHtml?: string;
  timestamp: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  quietMs?: number;
  sentinel?: string;
}

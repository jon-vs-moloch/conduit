export const SELECTORS = {
  composer: 'textarea[id="prompt-textarea"], [role="textbox"][contenteditable="true"]',
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send message"]',
  stopButton: 'button[aria-label="Stop generating"], button[data-testid="stop-button"]',
  assistantMessage: '[data-message-author-role="assistant"]'
};

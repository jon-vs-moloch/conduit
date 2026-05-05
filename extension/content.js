console.log('[Conduit Bridge] Content script loaded on ChatGPT.');

const seenBlocks = new Set();
const deliveredTransportIds = new Set();
let lastObservedText = '';

const SEND_MAX_ATTEMPTS = 5;
const SEND_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

const observer = new MutationObserver(() => {
  scheduleScan();
});

reportTabStatus('content_script_loaded');
setInterval(() => reportTabStatus('content_script_alive'), 10_000);

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanLatestAssistantMessage();
  }, 500);
}

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true
});

setInterval(scanLatestAssistantMessage, 2000);
pollForOutboundMessages();
scanLatestAssistantMessage();

function scanLatestAssistantMessage() {
  if (isGenerating()) return;

  const latestAssistant = findLatestAssistantMessage();
  if (!latestAssistant) return;

  const text = latestAssistant.innerText || '';
  if (!text || text === lastObservedText) return;

  lastObservedText = text;
  const blocks = extractProtocolBlocks(text);
  for (const block of blocks) {
    const key = stableKey(block);
    if (seenBlocks.has(key)) continue;
    seenBlocks.add(key);

    console.log(`[Conduit Bridge] Detected ${block.kind}. Forwarding to background script.`);
    chrome.runtime.sendMessage({
      type: 'CONDUIT_PROTOCOL_BLOCK',
      payload: block.text,
      kind: block.kind,
      key,
      url: location.href,
      observedAt: new Date().toISOString()
    });
  }
}

function reportTabStatus(status) {
  chrome.runtime.sendMessage({
    type: 'TAB_STATUS',
    status,
    url: location.href,
    observedAt: new Date().toISOString()
  });
}

function findLatestAssistantMessage() {
  const candidates = [
    ...document.querySelectorAll('[data-message-author-role="assistant"]'),
    ...document.querySelectorAll('article[data-testid^="conversation-turn-"]')
  ];

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const element = candidates[index];
    const authorRole = element.getAttribute('data-message-author-role');
    const testId = element.getAttribute('data-testid') || '';
    if (authorRole === 'assistant' || testId.includes('assistant')) {
      return element;
    }
  }

  return null;
}

function isGenerating() {
  return document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"]') !== null;
}

function extractProtocolBlocks(text) {
  return dedupeBlocks([
    ...extractNamedBlocks(text),
    ...extractRenderedNamedBlocks(text),
    ...extractLegacyBlocks(text, 'legacy-actions', '<<<ACTIONS_JSON', 'ACTIONS_JSON>>>'),
    ...extractLegacyBlocks(text, 'legacy-final', '<<<FINAL_JSON', 'FINAL_JSON>>>')
  ]);
}

function extractNamedBlocks(text) {
  const blocks = [];
  const pattern = /(?:^|\n)(```[ \t]*(?:json[ \t]+)?(conduit-call|conduit-final|conduit-handshake-request|veyr-call|veyr-final|conduit)(?:[ \t]+json)?[^\n]*\n([\s\S]*?)\n```)/g;
  for (const match of text.matchAll(pattern)) {
    blocks.push({
      kind: match[2],
      text: match[1],
      jsonText: (match[3] || '').trim()
    });
  }
  return blocks;
}

function extractLegacyBlocks(text, kind, start, end) {
  const blocks = [];
  const pattern = new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, 'g');
  for (const match of text.matchAll(pattern)) {
    blocks.push({
      kind,
      text: match[0],
      jsonText: (match[1] || '').trim()
    });
  }
  return blocks;
}

function extractRenderedNamedBlocks(text) {
  const blocks = [];
  for (const kind of ['conduit', 'conduit-call', 'conduit-final', 'conduit-handshake-request', 'veyr-call', 'veyr-final']) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const labelIndex = text.indexOf(kind, searchFrom);
      if (labelIndex === -1) break;
      if (isInsideFencedBlock(text, labelIndex)) {
        searchFrom = labelIndex + kind.length;
        continue;
      }

      const jsonStart = text.indexOf('{', labelIndex + kind.length);
      if (jsonStart === -1) break;

      const jsonEnd = findJsonObjectEnd(text, jsonStart);
      if (jsonEnd === -1) {
        searchFrom = jsonStart + 1;
        continue;
      }

      const jsonText = text.slice(jsonStart, jsonEnd + 1).trim();
      if (isValidJson(jsonText)) {
        blocks.push({
          kind,
          text: [
            `\`\`\`${kind}`,
            jsonText,
            '```'
          ].join('\n'),
          jsonText
        });
      }

      searchFrom = jsonEnd + 1;
    }
  }
  return blocks;
}

function findJsonObjectEnd(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function isValidJson(jsonText) {
  try {
    JSON.parse(jsonText);
    return true;
  } catch {
    return false;
  }
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  const deduped = [];
  for (const block of blocks) {
    const key = stableKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
  }
  return deduped;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideFencedBlock(text, index) {
  const before = text.slice(0, index);
  const matches = before.match(/```/g);
  return ((matches && matches.length) || 0) % 2 === 1;
}

function stableKey(block) {
  return `${block.kind}:${block.jsonText}`;
}

function pollForOutboundMessages() {
  chrome.runtime.sendMessage({ type: 'POLL_OUTBOUND' }, (response) => {
    if (chrome.runtime.lastError) {
      setTimeout(pollForOutboundMessages, 2000);
      return;
    }

    if (response && response.message) {
      const envelope = normalizeOutboundEnvelope(response);
      console.log(`[Conduit Bridge] Received outbound ${envelope.transportId} from Conduit CLI (${envelope.message.length} chars).`);
      void sendMessageReliably(envelope).catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error('[Conduit Bridge] Unhandled send failure:', error);
        reportSendResult('failed', envelope, 0, messageText);
      });
    }

    setTimeout(pollForOutboundMessages, 1000);
  });
}

function normalizeOutboundEnvelope(response) {
  return {
    transportId: response.transportId || `legacy-${Date.now()}`,
    createdAt: response.createdAt || new Date().toISOString(),
    message: response.message
  };
}

async function sendMessageReliably(envelope) {
  if (deliveredTransportIds.has(envelope.transportId) || findSentMessageByTransportId(envelope.transportId)) {
    deliveredTransportIds.add(envelope.transportId);
    reportSendResult('sent', envelope, 0, undefined, true);
    return;
  }

  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      if (findSentMessageByTransportId(envelope.transportId)) {
        deliveredTransportIds.add(envelope.transportId);
        reportSendResult('sent', envelope, attempt, undefined, true);
        return;
      }

      const composer = findComposer();
      if (!composer) throw new Error('Composer not ready');

      console.log(`[Conduit Bridge] outbound ${envelope.transportId} insert attempt=${attempt} composer=${describeElement(composer)}`);
      await clearComposerIfNeeded(composer, envelope.transportId);
      if (!composerTextIncludes(composer, envelope.transportId)) {
        const inserted = setComposerText(composer, envelope.message);
        if (!inserted) throw new Error('Composer text insertion failed');
      }

      await waitForComposerStable(composer, 30_000);
      console.log(`[Conduit Bridge] outbound ${envelope.transportId} composer stable after ${Date.now() - startedAt}ms`);
      await waitForUploadsSettled(composer, 60_000);
      console.log(`[Conduit Bridge] outbound ${envelope.transportId} uploads settled after ${Date.now() - startedAt}ms`);
      const sendButton = await waitForSendEnabled(composer, 60_000);
      await delay(250);
      if (!isSendButtonEnabled(sendButton) || !composerHasContentOrAttachment(composer)) {
        throw new Error('Send button unavailable');
      }

      sendButton.click();
      console.log(`[Conduit Bridge] outbound ${envelope.transportId} clicked send`);
      await waitForMessageCommitted(envelope.transportId, 45_000);
      console.log(`[Conduit Bridge] outbound ${envelope.transportId} committed after ${Date.now() - startedAt}ms`);
      deliveredTransportIds.add(envelope.transportId);
      reportSendResult('sent', envelope, attempt);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableSendError(message);
      console.warn(`[Conduit Bridge] outbound ${envelope.transportId} attempt=${attempt} failed retryable=${retryable} error="${message}"`);

      if (findSentMessageByTransportId(envelope.transportId)) {
        deliveredTransportIds.add(envelope.transportId);
        reportSendResult('sent', envelope, attempt, undefined, true);
        return;
      }

      if (!retryable || attempt === SEND_MAX_ATTEMPTS) {
        reportSendResult('failed', envelope, attempt, message);
        return;
      }

      await delay(SEND_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}

function findComposer() {
  const selectors = [
    '#prompt-textarea',
    'textarea[placeholder]',
    '[role="textbox"][contenteditable="true"]',
    'main form div[contenteditable="true"]',
    'form div[contenteditable="true"]',
    'div[contenteditable="true"]'
  ];
  const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  return candidates.find((element) => isVisible(element) && !element.closest('[data-message-author-role="assistant"]')) || null;
}

function setComposerText(composer, message) {
  composer.focus();

  if (isTextInput(composer)) {
    setNativeValue(composer, message);
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: message
    }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    return composerTextIncludes(composer, message);
  }

  if (insertWithExecCommand(composer, message)) {
    return true;
  }

  if (insertWithPasteEvent(composer, message)) {
    return true;
  }

  composer.replaceChildren(document.createTextNode(message));
  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: message
  }));
  return composerTextIncludes(composer, message);
}

async function clearComposerIfNeeded(composer, transportId) {
  if (composerTextIncludes(composer, transportId)) return;
  if (!composerHasContentOrAttachment(composer)) return;

  composer.focus();
  const removeButtons = [...document.querySelectorAll('button[aria-label*="Remove"], button[aria-label*="remove"], button[data-testid*="remove"]')]
    .filter((button) => composer.closest('form')?.contains(button) && isVisible(button));
  for (const button of removeButtons) {
    button.click();
    await delay(100);
  }

  if (isTextInput(composer)) {
    setNativeValue(composer, '');
  } else {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete');
      selection.removeAllRanges();
    }
    composer.replaceChildren();
  }

  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward'
  }));

  await pollUntil(() => !composerHasContentOrAttachment(composer), 5_000, 'Timed out waiting for composer to clear');
}

function insertWithExecCommand(composer, message) {
  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);

  const inserted = document.execCommand('insertText', false, message);
  selection.removeAllRanges();
  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: message
  }));

  return inserted && composerTextIncludes(composer, message);
}

function insertWithPasteEvent(composer, message) {
  try {
    const data = new DataTransfer();
    data.setData('text/plain', message);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });
    composer.dispatchEvent(event);
    return composerTextIncludes(composer, message);
  } catch {
    return false;
  }
}

function isTextInput(element) {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }
  element.value = value;
}

function composerTextIncludes(composer, message) {
  const probe = message.slice(0, Math.min(message.length, 120));
  const value = 'value' in composer ? composer.value : '';
  const innerText = composer.innerText || '';
  const textContent = composer.textContent || '';
  return value.includes(probe) || innerText.includes(probe) || textContent.includes(probe);
}

async function waitForSendButton(composer) {
  return waitForSendEnabled(composer, 5_000).catch(() => null);
}

async function waitForComposerStable(composer, timeoutMs) {
  let lastSnapshot = '';
  let lastChangedAt = Date.now();
  await pollUntil(() => {
    const snapshot = getComposerSnapshot(composer);
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      lastChangedAt = Date.now();
      return false;
    }
    return Date.now() - lastChangedAt >= 750;
  }, timeoutMs, 'Timed out waiting for composer stabilization');
}

async function waitForUploadsSettled(composer, timeoutMs) {
  await pollUntil(() => {
    return !hasVisibleUploadProgress(composer) && !hasVisibleComposerSpinner(composer) && !hasPendingAttachmentCard(composer);
  }, timeoutMs, 'Attachment still uploading');
}

async function waitForSendEnabled(composer, timeoutMs) {
  return pollUntilReturn(() => {
    const button = findSendButton(composer);
    if (!isSendButtonEnabled(button)) return null;
    if (!composerHasContentOrAttachment(composer)) return null;
    return button;
  }, timeoutMs, 'Timed out waiting for send button');
}

function findSendButton(composer) {
  const form = composer.closest('form');
  const selectors = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-submit-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[type="submit"]'
  ];

  for (const root of [form, document]) {
    if (!root) continue;
    for (const selector of selectors) {
      const button = root.querySelector(selector);
      if (button && isVisible(button)) {
        return button;
      }
    }
  }

  return null;
}

async function waitForMessageCommitted(transportId, timeoutMs) {
  await pollUntil(() => findSentMessageByTransportId(transportId), timeoutMs, `Timed out waiting for committed message ${transportId}`);
}

function findSentMessageByTransportId(transportId) {
  const composer = findComposer();
  const candidates = [
    ...document.querySelectorAll('[data-message-author-role="user"]'),
    ...document.querySelectorAll('article[data-testid^="conversation-turn-"]')
  ];
  return candidates.some((element) => {
    if (composer && element.contains(composer)) return false;
    const role = element.getAttribute('data-message-author-role');
    const testId = element.getAttribute('data-testid') || '';
    if (role !== 'user' && !testId.includes('user')) return false;
    return (element.innerText || element.textContent || '').includes(transportId);
  });
}

function isRetryableSendError(error) {
  return [
    'Send button unavailable',
    'Composer not ready',
    'Attachment still uploading',
    'Timed out waiting for send button',
    'Timed out waiting for composer stabilization',
    'Timed out waiting for committed message',
    'Timed out waiting for composer to clear',
    'Composer text insertion failed'
  ].some((fragment) => error.includes(fragment));
}

function reportSendResult(status, envelope, attempts, error, deduped) {
  chrome.runtime.sendMessage({
    type: 'SEND_RESULT',
    status,
    transportId: envelope.transportId,
    messageChars: envelope.message.length,
    attempts,
    deduped,
    error
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(predicate, timeoutMs, timeoutMessage) {
  await pollUntilReturn(() => predicate() ? true : null, timeoutMs, timeoutMessage);
}

function pollUntilReturn(predicate, timeoutMs, timeoutMessage) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(timeoutMessage));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function getComposerSnapshot(composer) {
  return JSON.stringify({
    textLength: getElementText(composer).length,
    attachmentCount: getComposerAttachmentCount(composer),
    progressCount: getVisibleUploadElements(composer).length,
    sendEnabled: isSendButtonEnabled(findSendButton(composer)),
    htmlLength: composer.innerHTML?.length || 0
  });
}

function getElementText(element) {
  const value = 'value' in element ? element.value : '';
  return value || element.innerText || element.textContent || '';
}

function composerHasContentOrAttachment(composer) {
  return getElementText(composer).trim().length > 0 || getComposerAttachmentCount(composer) > 0;
}

function getComposerAttachmentCount(composer) {
  const form = composer.closest('form');
  if (!form) return 0;
  return [
    ...form.querySelectorAll('[data-testid*="attachment"], [aria-label*="attachment"], [aria-label*="Attachment"], [class*="attachment"]')
  ].filter(isVisible).length;
}

function hasVisibleUploadProgress(composer) {
  return getVisibleUploadElements(composer).length > 0;
}

function getVisibleUploadElements(composer) {
  const form = composer.closest('form') || document;
  return [...form.querySelectorAll('[role="progressbar"], progress, [aria-busy="true"]')].filter(isVisible);
}

function hasVisibleComposerSpinner(composer) {
  const form = composer.closest('form') || document;
  return [...form.querySelectorAll('[class*="spinner"], [class*="loading"], svg')]
    .some((element) => isVisible(element) && /upload|loading|processing/i.test(element.getAttribute('aria-label') || element.textContent || ''));
}

function hasPendingAttachmentCard(composer) {
  const form = composer.closest('form');
  if (!form) return false;
  return /uploading|processing|preparing|scanning/i.test(form.innerText || form.textContent || '');
}

function isSendButtonEnabled(button) {
  if (!button) return false;
  return isVisible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function describeElement(element) {
  const id = element.id ? `#${element.id}` : '';
  const role = element.getAttribute('role') ? `[role="${element.getAttribute('role')}"]` : '';
  const editable = element.getAttribute('contenteditable') ? `[contenteditable="${element.getAttribute('contenteditable')}"]` : '';
  return `<${element.tagName.toLowerCase()}${id}${role}${editable}>`;
}

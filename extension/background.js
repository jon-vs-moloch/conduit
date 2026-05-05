const BRIDGE_BASE_URL = 'http://127.0.0.1:3333';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Conduit Bridge] Extension installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONDUIT_PROTOCOL_BLOCK' || message.type === 'CONDUIT_CALL') {
    forwardProtocolBlock(message, sender)
      .then((data) => {
        console.log('[Conduit Bridge] Forwarded protocol block to Conduit CLI:', data);
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error('[Conduit Bridge] Failed to forward protocol block. Is Conduit running with --transport extension?', error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === 'SEND_RESULT') {
    postJson('/api/conduit-send-result', {
      tabId: sender.tab?.id,
      transportId: message.transportId,
      status: message.status,
      messageChars: message.messageChars,
      attempts: message.attempts,
      deduped: message.deduped,
      error: message.error
    }).catch((error) => {
      console.warn('[Conduit Bridge] Failed to report send result:', error);
    });
    return false;
  }

  if (message.type === 'POLL_OUTBOUND') {
    fetch(`${BRIDGE_BASE_URL}/api/conduit-outbound`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => sendResponse(data))
      .catch(() => sendResponse({ message: null }));
    return true;
  }

  return false;
});

async function forwardProtocolBlock(message, sender) {
  return postJson('/api/conduit-call', {
    payload: message.payload,
    kind: message.kind,
    key: message.key,
    url: message.url || sender.tab?.url,
    tabId: sender.tab?.id,
    observedAt: message.observedAt || new Date().toISOString()
  });
}

async function postJson(path, body) {
  const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

const BRIDGE_BASE_URL = 'http://127.0.0.1:3333';

const elements = {
  stateBadge: document.getElementById('stateBadge'),
  tabState: document.getElementById('tabState'),
  outboundState: document.getElementById('outboundState'),
  lastTab: document.getElementById('lastTab'),
  lastSend: document.getElementById('lastSend'),
  lastError: document.getElementById('lastError'),
  attentionPanel: document.getElementById('attentionPanel'),
  attentionText: document.getElementById('attentionText'),
  retryButton: document.getElementById('retryButton'),
  refreshButton: document.getElementById('refreshButton')
};

let latestHealth = null;

elements.refreshButton.addEventListener('click', () => refresh());
elements.retryButton.addEventListener('click', async () => {
  const transportId = selectRetryTransportId(latestHealth);
  await postJson('/api/conduit-retry', transportId ? { transportId } : {});
  await refresh();
});

refresh();

async function refresh() {
  setBadge('Checking', '');
  try {
    latestHealth = await getJson('/health');
    render(latestHealth);
  } catch (error) {
    latestHealth = null;
    setBadge('Offline', 'error');
    elements.tabState.textContent = 'offline';
    elements.outboundState.textContent = '-';
    elements.lastTab.textContent = 'Bridge server not reachable';
    elements.lastSend.textContent = '-';
    elements.lastError.textContent = error instanceof Error ? error.message : String(error);
    elements.attentionPanel.classList.add('hidden');
  }
}

function render(health) {
  const needsAttention = health.lastTransportError?.needsAttention === true || health.attentionOutbound > 0;
  const hasTab = health.tabStatusCount > 0;
  setBadge(needsAttention ? 'Attention' : hasTab ? 'Connected' : 'No tab', needsAttention ? 'error' : hasTab ? 'ok' : '');

  elements.tabState.textContent = hasTab ? 'alive' : 'missing';
  elements.outboundState.textContent = outboundSummary(health);
  elements.lastTab.textContent = health.lastTabStatus
    ? `${health.lastTabStatus.status || 'unknown'} · ${health.lastTabStatus.title || health.lastTabStatus.url || 'unknown tab'}`
    : 'No content-script heartbeat';
  elements.lastSend.textContent = health.lastSendResult
    ? `${health.lastSendResult.status || 'unknown'} ${health.lastSendResult.transportId || ''}`.trim()
    : 'No send result yet';
  elements.lastError.textContent = health.lastTransportError
    ? health.lastTransportError.error || health.lastTransportError.status || 'Unknown transport error'
    : 'None';

  if (needsAttention) {
    const id = health.attentionOutboundIds?.[0] || health.lastTransportError?.transportId || 'unknown';
    elements.attentionText.textContent = `${id}: ${elements.lastError.textContent}`;
    elements.attentionPanel.classList.remove('hidden');
  } else {
    elements.attentionPanel.classList.add('hidden');
  }
}

function outboundSummary(health) {
  if (health.attentionOutbound > 0) return `${health.attentionOutbound} attention`;
  if (health.retryingOutbound > 0) return `${health.retryingOutbound} retrying`;
  if (health.pendingSendResults > 0) return `${health.pendingSendResults} sending`;
  if (health.outboundQueued > 0) return `${health.outboundQueued} queued`;
  return 'idle';
}

function selectRetryTransportId(health) {
  return health?.attentionOutboundIds?.[0]
    || health?.retryingOutboundIds?.[0]
    || health?.pendingSendResultIds?.[0];
}

function setBadge(text, className) {
  elements.stateBadge.textContent = text;
  elements.stateBadge.className = className;
}

async function getJson(path) {
  const response = await fetch(`${BRIDGE_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

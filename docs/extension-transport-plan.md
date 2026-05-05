# Extension Transport Plan

This plan replaces the Playwright-first transport path with a principled browser-extension bridge.

Goal:

```txt
Local Conduit runtime
  <-> local bridge server
  <-> browser extension background/service worker
  <-> content script in an authenticated ChatGPT tab
  <-> ChatGPT web UI
```

The user authenticates normally in their browser. Conduit does not bypass login, solve challenges, extract cookies, or disguise automation. The extension is an explicit user-installed augmentation layer.

## Why Extension Transport

The Playwright path is blocked by auth and bot-detection friction.

Accessibility/JXA is acceptable for a Mac prototype, but it requires visible/focused windows and is not a good autonomy substrate.

A browser extension is the most principled long-term path because:

- it runs in the user's real authenticated browser profile
- it can act on permitted ChatGPT tabs without Terminal focus
- it has an explicit permission model
- it can communicate with a local Conduit app
- it can be packaged and reviewed later
- it avoids stealth/fingerprint evasion

## Boundaries

Allowed:

- user-installed unpacked extension during development
- narrow host permissions for ChatGPT
- user-visible local bridge server
- explicit local app permission prompts
- visible status when a ChatGPT tab is connected
- DOM parsing of visible ChatGPT content
- inserting/sending messages in an open ChatGPT conversation

Not allowed:

- CAPTCHA solving
- stealth/fingerprint evasion
- extracting browser cookies or hidden auth state
- bypassing ChatGPT or browser security boundaries
- acting on sites/tabs the user has not authorized
- broad host permissions when narrow permissions work

## Architecture

### Local Conduit Runtime

Owns:

- tasks
- run state
- tool execution
- policy
- logs
- approvals
- local bridge server

### Local Bridge Server

Initial transport can be HTTP polling or WebSocket.

Recommended first spike:

```txt
http://127.0.0.1:{port}
```

Endpoints:

```txt
GET  /health
POST /extension/hello
POST /extension/event
GET  /extension/next-message?tabId=...
POST /extension/result
```

Prefer HTTP polling for the first spike because it is easier to debug than WebSocket and less likely to run into CSP surprises. WebSocket can come later if needed.

### Browser Extension Background

Owns:

- lifecycle
- tab discovery
- message routing
- communication with local bridge
- extension badge/status

Responsibilities:

- register content script on allowed ChatGPT origins
- receive events from content script
- send events to local bridge
- poll local bridge for outbound messages
- forward outbound messages to content script

### Content Script

Runs inside the ChatGPT page.

Responsibilities:

- detect assistant message changes
- extract visible text and code blocks
- find `conduit-call` and `conduit-final` blocks
- do not require a separate end-turn marker
- send protocol blocks to extension background
- receive `TOOL_RESULTS_JSON` messages from runtime
- insert and submit harness messages into ChatGPT
- report page status and errors

## Permissions

Start narrow.

Manifest host permissions:

```json
[
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*"
]
```

Extension permissions:

```json
[
  "tabs",
  "scripting",
  "storage"
]
```

Only add more permissions when a concrete implementation need appears.

## Directory Structure

Recommended scaffold:

```txt
extension/
  manifest.json
  src/
    background.ts
    content-script.ts
    dom/
      chatgpt-selectors.ts
      extract-protocol-blocks.ts
      message-composer.ts
    bridge/
      client.ts
      types.ts
    ui/
      popup.html
      popup.ts
  assets/
    icon-16.png
    icon-48.png
    icon-128.png

src/bridge/
  server.ts
  types.ts
  extension-session.ts
```

Keep extension code separate from Node runtime code. Share protocol schemas only if the build setup makes that easy; otherwise duplicate tiny wire types and keep protocol tests in the Node runtime.

## Wire Events

Extension to runtime:

```ts
type ExtensionEvent =
  | {
      type: 'hello'
      extensionVersion: string
      tabId?: number
      url?: string
    }
  | {
      type: 'tab_status'
      tabId: number
      url: string
      status: 'connected' | 'missing_composer' | 'auth_required' | 'unsupported_page'
      title?: string
    }
  | {
      type: 'assistant_protocol_block'
      tabId: number
      kind: 'conduit-call' | 'conduit-final'
      text: string
      messageId?: string
      observedAt: string
    }
  | {
      type: 'send_result'
      tabId: number
      status: 'sent' | 'failed'
      error?: string
    }
```

Runtime to extension:

```ts
type RuntimeMessage =
  | {
      type: 'send_to_chatgpt'
      tabId: number
      runId: string
      text: string
    }
  | {
      type: 'status_request'
      tabId?: number
    }
```

## Build Phases

### Phase 0 — Keep Existing Paths Green

Before adding extension work:

```txt
npm run build
npm test
npm run spike
```

Acceptance:

- no regression in fake or clipboard paths

### Phase 1 — Local Bridge Server

Implement a small local bridge in the Node runtime.

CLI command:

```txt
npm run conduit -- bridge
```

Behavior:

- starts local HTTP server on `127.0.0.1`
- chooses a default port, e.g. `8787`
- prints URL and health status
- accepts `POST /extension/hello`
- accepts `POST /extension/event`
- returns no-op from `GET /extension/next-message`
- logs events to terminal

Acceptance:

- `curl http://127.0.0.1:8787/health` works
- posting a fake extension event logs it
- unit tests cover request validation

### Phase 2 — Unpacked Extension Skeleton

Create a minimal Manifest V3 extension.

Behavior:

- loads unpacked in Chrome
- background service worker starts
- content script runs on `chatgpt.com`
- extension badge/popup shows connection status
- content script sends `hello` or `tab_status` to background
- background forwards it to local bridge

Acceptance:

- user can load extension unpacked
- opening ChatGPT sends a visible event to `npm run conduit -- bridge`
- no ChatGPT DOM manipulation yet

### Phase 3 — Protocol Block Detection

Implement content-script parsing for visible assistant messages.

Behavior:

- watches the ChatGPT conversation region with `MutationObserver`
- extracts visible text/code blocks from assistant messages
- finds `conduit-call` and `conduit-final`
- de-duplicates already-seen blocks
- sends `assistant_protocol_block` events to bridge

Acceptance:

- if the user asks ChatGPT to emit a `conduit-call` block, the bridge logs it
- normal prose without protocol blocks is ignored
- duplicate DOM updates do not send duplicate events

### Phase 4 — Runtime Action Dispatch

Connect extension protocol events to the existing run loop.

Recommended shape:

- create an `ExtensionTransport` implementing `ModelTransport`
- `waitForAssistantTurn` waits for the next protocol event from the bridge
- `sendMessage` queues a `send_to_chatgpt` message for the extension

Acceptance:

- runtime can receive `conduit-call` from extension
- runtime executes `file.read`
- runtime queues `TOOL_RESULTS_JSON` back to extension
- logs remain the same as fake/clipboard runs

Current status:

- basic `ExtensionTransport` exists
- local bridge listens on `127.0.0.1:3333`
- `/health`, `/api/conduit-call`, `/api/conduit-outbound`, and `/api/conduit-send-result` exist
- inbound protocol blocks queue safely
- duplicate inbound protocol blocks are ignored by key
- outbound messages queue safely
- persistent `listen` command exists
- `listen` closes sessions on `conduit-final` but leaves the bridge open
- focused tests cover these transport behaviors

### Phase 5 — Send Messages Back Into ChatGPT

Implement content-script composer control.

Behavior:

- find composer
- insert text
- submit message
- report `send_result`

Acceptance:

- extension can paste/send `TOOL_RESULTS_JSON` into the active ChatGPT conversation
- model can emit `conduit-final`
- real extension transport completes the README fixture run

Current status:

- content script polls for outbound messages
- content script attempts composer insertion and send-button click
- this still needs manual hardening against ChatGPT UI changes

### Phase 6 — Tab/Throttle Detection

Add visibility and health checks.

Detect:

- tab hidden
- tab discarded/unloaded
- content script disconnected
- composer missing
- auth page or Cloudflare page
- message send failure
- no assistant update within timeout

Behavior:

- report status to runtime
- pause run if the tab is unavailable
- ask user to reopen/focus/reload only when necessary

Acceptance:

- runtime can distinguish "waiting on model" from "tab unavailable"
- user gets actionable status

### Phase 7 — Permissions and UX Hardening

Add:

- popup status
- connect/disconnect button
- selected tab indicator
- local bridge URL/status
- explicit "Conduit is connected to this ChatGPT tab" state

Acceptance:

- user understands when extension is active
- no hidden background action on unrelated tabs

## Testing Plan

Runtime tests:

- bridge request validation
- bridge event queue
- transport recommendation logic
- extension transport fake event flow

Extension tests:

- protocol block extraction from static HTML fixtures
- de-duplication
- composer insertion helper with DOM fixtures

Manual tests:

```txt
npm run build
npm test
npm run conduit -- bridge
```

Then:

1. Load unpacked extension.
2. Open authenticated ChatGPT tab.
3. Confirm `tab_status` appears in bridge logs.
4. Ask ChatGPT to emit `conduit-call`.
5. Confirm bridge receives block.
6. Run README fixture through extension transport.

Do not require live ChatGPT extension tests in CI.

## Security Notes

- Bind local bridge to `127.0.0.1` only.
- Use an unpredictable session token printed by the bridge and stored by the extension during pairing.
- Reject extension events without a valid token after pairing exists.
- Do not expose arbitrary shell/tool endpoints over HTTP.
- Runtime must keep policy enforcement; extension only transports messages.
- Keep run logs local.
- Surface every high-risk action to the user.

## Open Questions

- HTTP polling or WebSocket after Phase 1?
- Native messaging vs localhost bridge for packaged app?
- How should the extension pair with the local runtime?
- How should multiple ChatGPT tabs be selected?
- How much UI belongs in extension popup vs local Conduit app?

Default answers for now:

- HTTP polling first.
- localhost bridge first.
- one generated local pairing token.
- one active tab selected explicitly by user.
- minimal popup; richer UI later in local app.

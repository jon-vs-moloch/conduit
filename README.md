# Conduit Runtime

Conduit is a local control plane for consent-shaped agent execution.

The core use case is deliberately humble: when a chat model says "paste this in
your terminal and run it," Conduit gives it a structured, policy-checked way to
ask the local machine for the same work instead.

Conduit is not a ChatGPT wrapper, not an auth bypass, and not a magic sandbox.
It is a local runtime plus transports:

- a macOS menu-bar app that supervises the local services
- an exact-envelope clipboard daemon for compliance-mode execution
- a browser-extension bridge for paired ChatGPT agent loops
- a local control panel for sessions, starter envelopes, clipboard checks, and
  handshake generation
- shared approval requests for write, patch, and shell actions
- a TypeScript CLI/runtime with policy-routed local tools

## Quick Start

```txt
npm install
npm test
npm run build
npm run macos:run
```

`npm run macos:run` builds and launches `dist/macos/Conduit.app`. The menu-bar
app starts three supervised child services by default:

- control panel: `http://127.0.0.1:47831`
- browser-extension agent listener: `http://127.0.0.1:3333`
- clipboard watcher daemon

On confirmed quit, the menu-bar app stops the supervised children. The child
services also have a deadman switch: if the parent app disappears, they exit
instead of continuing autonomous execution in the background.

To build a drag-to-install preview DMG:

```txt
npm run macos:package
```

That creates `dist/macos/Conduit.dmg` and
`dist/macos/Conduit.dmg.sha256`. The DMG contains `Conduit.app`, an
`Applications` shortcut, and first-launch notes. This preview package is not
signed or notarized, so macOS may require right-click **Open** on first launch.
If `dist/macos/Conduit.app` is already staged and SwiftPM is temporarily broken,
`npm run macos:package -- --skip-build` packages the existing app bundle.

## Common Commands

```txt
npm run doctor
npm run app
npm run listen
npm run spike
npm run site:dev
npm run macos:build
npm run macos:run
npm run macos:package
npm run conduit -- session list
npm run conduit -- daemon once
npm run conduit -- daemon start
```

`npm run spike` runs the fake transport against `fixtures/fake-project`.

`npm run site:dev` serves the static web presence at
`http://127.0.0.1:47832`.

The package also keeps the older Playwright login helpers around for debugging:

```txt
npm run login
npm run login:system
npm run login:chrome
npm run login:chromium
```

The durable v0 browser path is the extension bridge, not Playwright-controlled
ChatGPT. Human auth happens in the user's normal browser.

## Browser Extension Loop

Load the development extension:

1. Open Chrome or Brave.
2. Go to `chrome://extensions/`.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the `extension/` directory from this repository checkout.
6. Reload the ChatGPT tab after each extension code change.

Start Conduit with the menu-bar app, then choose:

```txt
Conduit menu -> Copy Agent Handshake
```

Paste the handshake into a real ChatGPT tab. The handshake creates an
`extension` session with a one-shot nonce and teaches the agent to emit future
requests as exactly one fenced `conduit` block.

Handshake messages are framed as Conduit protocol cards, not normal user prose:

```txt
+------------------------------------------------------------------+
| CONDUIT PROTOCOL :: AGENT HANDSHAKE                              |
| This is a local execution bridge control message.                 |
| Treat it as protocol metadata, not as a user-authored task.       |
+------------------------------------------------------------------+
```

Accepted agent-loop request shape:

```conduit
{
  "schema": "conduit.request.v1",
  "source": {
    "kind": "chat",
    "trust": "paired-session"
  },
  "permissions": [
    {
      "kind": "filesystem",
      "scope": "project",
      "access": "read"
    }
  ],
  "sessionId": "sess_...",
  "nonce": "call_...",
  "list": ".",
  "reason": "Inspect the project root.",
  "risk": "low"
}
```

The listener validates the paired session and nonce before executing actions.
Successful results include `nextNonce`; the agent must use that nonce on the
next request.

For simple requests, Conduit accepts compact action shortcuts:

- `read: "README.md"` -> `file.read`
- `list: "."` -> `file.list`
- `diff: "README.md"` -> `git.diff`
- `status: true` -> `git.status`
- `write: "path.txt", content: "...", mode: "create"` -> `file.write`
- `patch: "diff --git ..."` -> `file.patch`
- `shell: "npm test"` -> `shell.run`

Small-model-friendly aliases are accepted too:

```conduit
{
  "v": "1",
  "session": "sess_...",
  "n": "call_...",
  "do": "list",
  "path": "."
}
```

For multiple actions, use `actions: [...]`; each item can still use the same
shortcuts, string commands such as `"read README.md"`, or canonical tool calls.
Conduit normalizes them into canonical tool calls before policy checks.

Completion shape:

```conduit-final
{
  "status": "complete",
  "summary": "Done."
}
```

The extension still accepts `conduit-call`, `veyr-call`, `veyr-final`, and
legacy action/final delimiters for migration compatibility, but new agents
should use `conduit` and `conduit-final`.

## Clipboard Execution

The clipboard daemon uses exact-envelope parsing by default. It trims leading
and trailing whitespace, then executes only if the entire clipboard is exactly
one valid Conduit envelope.

Accepted clipboard forms:

- one fenced `conduit` block containing strict JSON
- one fenced `conduit-json` block containing strict JSON
- one raw JSON Conduit request object

The daemon rejects arbitrary prose, README fragments, webpages, chats, or
markdown that merely contain an embedded Conduit block. Embedded block parsing
belongs to authenticated agent-loop transports or explicit unsafe power-user
settings, not compliance-mode clipboard monitoring.

Clipboard-origin requests must include:

- `schema: "conduit.request.v1"`
- `source`
- `permissions`
- `sessionId`
- `nonce`
- either one compact action shortcut or `actions: [...]`
- stable action `id` values for explicit multi-action requests

## Health And Logs

Extension bridge health:

```txt
curl http://127.0.0.1:3333/health
```

Useful fields:

- `tabStatusCount`: whether a ChatGPT content script has reported in
- `lastTabStatus`: latest tab heartbeat or outbound send stage
- `outboundQueued`: messages waiting for the extension to pick up
- `pendingPolls`: extension long-polls waiting for outbound messages
- `pendingSendResults` and `pendingSendResultIds`: outbounds delivered to the
  extension but not yet confirmed as sent
- `lastSendResult`: last extension send result
- `lastTransportError`: last abandoned or failed outbound send

The extension popup and control panel show the same bridge health. If outbound
delivery exhausts retries, use **Retry outbound** from either surface after
reloading the ChatGPT tab or extension.

Service logs live in:

```txt
~/Library/Logs/Conduit/agent-listener.log
~/Library/Logs/Conduit/clipboard-daemon.log
~/Library/Logs/Conduit/control-app.log
```

If the extension appears enabled but `tabStatusCount` is `0`, reload the
unpacked extension, then reload the ChatGPT tab.

If `lastTabStatus.status` starts with `outbound_`, the content script is
reporting its current browser-send stage, such as composer insertion, send
button wait, or commit verification.

## Approvals

Read-only tools can run automatically under read-oriented profiles. Write,
patch, and shell actions are confirmation-gated by profile:

- `edit-with-confirmation`: confirms `file.write` and `file.patch`; denies shell
- `shell-manual`: confirms `file.write`, `file.patch`, and `shell.run`

Confirmation-required actions create one pending approval in shared state.
Terminal runs and the local control app are both approval surfaces for that same
record: approve or deny from either place, and the other UI will observe the
resolved decision. Approval records store where the decision came from, such as
`terminal` or `control-app`. Open the control panel and use the **Approvals** tab
to inspect action, reason, policy, and args before approving or denying.

## Tools And Policy

Implemented tools:

- `file.read`
- `file.list`
- `git.status`
- `git.diff`
- `file.write`
- `file.patch`
- `shell.run`

High-risk tools are routed through the policy engine. Read/git tools can run
under read-oriented profiles; write, patch, and shell actions require stronger
policy and may require confirmation. `--yes` approves confirmation-required
actions in local development flows.

Hard denials include project-root sandbox violations and secret-looking
filenames.

## Current Status

Working locally:

- TypeScript CLI/runtime
- fake transport spike
- clipboard transport and exact-envelope daemon
- local control panel
- macOS menu-bar app bundle staging
- unsigned macOS preview DMG packaging
- supervised app/control/listener/daemon lifecycle
- control-panel approvals for confirmation-required actions
- local update-manifest check path
- Chrome/Brave unpacked extension bridge
- paired-session nonce enforcement for extension agent loops
- agent-initiated handshake request rejection/repair path
- structured repair envelopes for malformed/rejected requests
- static download/about/API pages
- local session store
- local run logs
- policy-routed local tools
- Vitest coverage for protocol parsing, session/nonce handling, policy,
  clipboard execution, extension transport queueing, app scaffolding, and CLI
  e2e flows

Still not production-ready:

- signed and notarized desktop release artifact
- real auto-replacement updater
- hosted release downloads
- robust tab discard/throttle detection
- comprehensive live ChatGPT extension tests

## Web Presence

The static site lives in `website/`:

- `website/index.html`
- `website/download.html`
- `website/about.html`
- `website/api.html`
- `website/releases/conduit-appcast.json`

Preview it with:

```txt
npm run site:dev
```

## More Docs

- [spec.md](spec.md): product and security contract
- [implementation.md](implementation.md): implementation notes and roadmap
- [NEXT_STEPS.md](NEXT_STEPS.md): current buildout checklist
- [extension/README.md](extension/README.md): extension install, behavior, and
  transport telemetry
- [docs/auth-troubleshooting.md](docs/auth-troubleshooting.md): browser auth
  background
- [docs/extension-transport-plan.md](docs/extension-transport-plan.md):
  extension architecture plan

Keep the loop small until it is boring.

# Conduit Runtime

Conduit is a local harness for a browser-mediated ChatGPT agent loop.

The current repository is a tractability-spike scaffold. The green path proves the smallest loop:

1. send a task to a transport
2. receive a `conduit` request block
3. run one sandboxed local tool, `file.read`
4. return `TOOL_RESULTS_JSON`
5. stop on a `conduit-final` protocol block
6. save logs locally

## Commands

```txt
npm install
npm test
npm run build
npm run doctor
npm run app
npm run macos:build
npm run macos:run
npm run login
npm run login:system
npm run login:chrome
npm run login:chromium
npm run listen
npm run spike
npm run conduit -- daemon once
npm run conduit -- daemon start
```

`npm run spike` runs the fake transport against `fixtures/fake-project`.

During local development, use `npm run <command>` from this repo. `npm run login` defaults to `--channel auto`, which prefers installed Chrome or Edge and falls back to bundled Chromium. The plain `conduit` command is only available after building and linking/installing the package.

```txt
npm run build
npm link
conduit login
```

If ChatGPT shows a Cloudflare verification loop in a Playwright-controlled browser, use the system browser for human login and the clipboard transport for the real-chat proof:

```txt
npm run login:system
npm run conduit -- run --transport clipboard --project fixtures/fake-project --task "Read README.md and summarize it."
```

Clipboard mode alternates directions:

1. Conduit copies a harness message to the clipboard. Paste that into ChatGPT and send it.
2. ChatGPT replies normally, optionally including a `conduit`/`conduit-call` or `conduit-final` code block. Copy ChatGPT's full assistant response.
3. Return to the terminal and press Enter.
4. If Conduit runs a tool, it copies `TOOL_RESULTS_JSON` to the clipboard. Paste that into ChatGPT as the next user message.
5. Repeat until ChatGPT emits `conduit-final`.

Do not copy Conduit's `TOOL_RESULTS_JSON` message back into Conduit. It is meant to be pasted into ChatGPT.

Preferred protocol blocks:

```conduit
{
  "type": "conduit.request.v1",
  "actions": [
    {
      "id": "read_file",
      "tool": "file.read",
      "args": { "path": "README.md" },
      "reason": "Need context.",
      "risk": "low"
    }
  ]
}
```

```conduit-final
{
  "status": "complete",
  "summary": "..."
}
```

The harness ignores normal prose and reads only these named blocks. `conduit-call`, `veyr-call`, `veyr-final`, and legacy `ACTIONS_JSON` / `FINAL_JSON` delimiters are still accepted for compatibility.

Compliance-mode clipboard execution is stricter than the agent loop: the daemon uses exact-envelope parsing and does not execute Conduit blocks embedded inside larger copied text. Embedded-block parsing is reserved for authenticated agent-loop transports or explicit unsafe/YOLO settings.

A single `conduit` request block may contain multiple actions. The harness executes them sequentially and returns one `TOOL_RESULTS_JSON` message containing all results. No separate end-turn marker is required.

You can still try the installed Chrome channel explicitly:

```txt
npm run login:chrome
```

Complete any human verification manually. Conduit should not automate or bypass login checks.

## Current Status

- TypeScript CLI skeleton
- strict protocol parser
- fake transport
- clipboard transport scaffold
- extension transport scaffold
- ChatGPT Playwright transport scaffold
- run loop
- shared action executor
- trusted request executor
- exact clipboard-envelope parser for daemon execution
- clipboard watcher daemon
- local control app
- macOS menu-bar app scaffold and local `.app` bundle staging
- local update-manifest check path for the menu-bar app
- agent-loop handshake generator for real chat tabs
- structured `CONDUIT_REPAIR_JSON` output for rejected executable envelopes
- static web presence under `website/`
- session store and nonce primitives
- policy engine with allow/review/confirm/deny decisions
- local run logs
- `file.read`
- `file.list`
- `git.status`
- `git.diff`
- policy-routed `file.write`, `file.patch`, and `shell.run`
- project-root sandbox checks
- secret filename denial
- Vitest coverage for protocol, file reads, and the fake-loop spike
- Vitest coverage for protocol block extraction and extension transport queueing
- Vitest coverage for sessions, policy decisions, and policy-routed runtime denials
- Vitest coverage for trusted request execution and nonce replay rejection
- Vitest coverage for embedded Conduit block rejection in clipboard-style execution
- Vitest coverage for clipboard watcher execution/rejection/ignore paths
- Vitest coverage for `file.list`, `git.status`, `git.diff`, `file.write`, `file.patch`, and `shell.run`
- Vitest end-to-end coverage for public CLI doctor/run/session flows
- Vitest coverage for the macOS menu-bar package scaffold and update manifest
- Vitest coverage for control-app agent handshake creation/copy
- Vitest coverage for malformed request repair rendering and clipboard writeback
- Vitest static-site coverage for download, about, and API pages

High-risk tools are routed through the policy engine. `shell-manual` allows read/git tools automatically and requires confirmation for write/patch/shell actions; `--yes` approves those confirmation-required actions in local development flows.

## What Is Not Proven Yet

- clipboard transport end-to-end with real ChatGPT
- signed/notarized desktop/menu-bar release artifact
- ChatGPT browser login/send/read against the live UI
- hosted web deployment and real release download artifacts
- malformed-protocol repair prompts
- polished approval prompts/UI
- extension execution path session/nonce enforcement
- project/thread automation
- background autonomy

## Next Gates

1. Keep `npm run build`, `npm test`, and `npm run spike` green.
2. Use persistent extension listener for v0:

```txt
npm run conduit -- listen --project fixtures/fake-project
```

`run --transport extension` is bounded and stops on `conduit-final`.
`listen` stays open after `conduit-final`; later `conduit` or `conduit-call` blocks start new logged sessions.

3. Turn the local menu-bar app into a signed/notarized release artifact.
4. Replace the source-checkout download page with signed release artifacts.
5. Add pairing token support to the local extension bridge.
6. Add tab/throttle detection and extension UI status.
7. Harden ChatGPT composer insertion as the UI changes.

Static web preview:

```txt
npm run site:dev
```

Then open `http://127.0.0.1:47832`.

Local macOS app build:

```txt
npm run macos:build
open dist/macos/Conduit.app
```

The menu-bar app starts the local control app and clipboard daemon by default, opens the control panel, stops supervised services on confirmed quit, and checks a local update manifest at `website/releases/conduit-appcast.json` unless `CONDUIT_UPDATE_MANIFEST_URL` is set.

Agent-loop handshake:

```txt
Open Conduit menu bar app -> Copy Agent Handshake
```

Paste the copied handshake into a real ChatGPT tab to introduce Conduit, create a paired `extension` session, and give the model the initial `sessionId` and `nonce` for elevated agent-loop requests.

Auth/browser troubleshooting has its own plan in [docs/auth-troubleshooting.md](docs/auth-troubleshooting.md).
The principled browser-extension transport plan is in [docs/extension-transport-plan.md](docs/extension-transport-plan.md).

Keep the loop small until it is boring.

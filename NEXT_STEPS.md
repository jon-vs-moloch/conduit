# Conduit Handoff Notes

Current state:

- Conduit was scaffolded from the sibling `veyr` project.
- Package/bin/state identity is now Conduit:
  - package name: `conduit`
  - bin: `conduit`
  - env override: `CONDUIT_STATE_DIR`
  - default state root: `~/.conduit`
- The agent loop works through the existing run/listen architecture.
- Native request blocks are accepted:

````txt
```conduit
{
  "type": "conduit.request.v1",
  "actions": [
    {
      "id": "read_readme",
      "tool": "file.read",
      "args": { "path": "README.md" },
      "reason": "Need context.",
      "risk": "low"
    }
  ]
}
```
````

- Compatibility blocks are still accepted:
  - `conduit-call`
  - `conduit-final`
  - `veyr-call`
  - `veyr-final`
  - legacy `ACTIONS_JSON` / `FINAL_JSON`
- Compact action shortcuts are accepted and normalized before policy/execution:
  - `read: "README.md"` -> `file.read`
  - `list: "."` -> `file.list`
  - `diff: "src/index.ts"` -> `git.diff`
  - `status: true` -> `git.status`
  - `write`, `patch`, and `shell` map to their corresponding high-risk tools
- Session primitives are implemented:
  - `src/sessions/nonce.ts`
  - `src/sessions/profiles.ts`
  - `src/sessions/session-store.ts`
  - `conduit session create/list/revoke`
  - nonce validation, consumption, and rotation
- Policy primitives are implemented:
  - `src/policy/policy-engine.ts`
  - `src/policy/budgets.ts`
  - `src/policy/risk.ts`
  - profile decisions for allow/review/confirm/deny
  - allowed-root checks
  - sensitive file read denial
  - action-count budget denial
- Shared action execution is implemented:
  - `src/runtime/execute-actions.ts`
  - run/listen loops route actions through policy
  - actions, policy decisions, and tool results are logged
  - confirmation-required actions still honor `--yes`
- Trusted request execution is implemented:
  - `src/daemon/execute-request.ts`
  - parses copied `conduit` request text
  - requires `sessionId` and `nonce`
  - consumes nonce before local execution
  - executes through the shared policy/action executor
  - renders `CONDUIT_RESULTS_JSON`
- Exact clipboard envelope parsing is implemented for daemon request execution:
  - `src/protocol/parse-clipboard-envelope.ts`
  - trims only leading/trailing whitespace
  - accepts standalone fenced `conduit` / `conduit-json` envelopes or raw JSON envelopes
  - rejects prose-wrapped and multi-envelope clipboard buffers
  - rejects duplicate JSON object keys
  - enforces a maximum envelope size
- The older embedded-block agent parser remains available for run/listen style flows, but should be treated as a YOLO/elevated authenticated-session capability, not as Compliance Mode clipboard behavior.
- Clipboard watcher daemon is implemented:
  - `src/daemon/clipboard-io.ts`
  - `src/daemon/clipboard-watcher.ts`
  - `src/daemon/daemon.ts`
  - `conduit daemon once`
  - `conduit daemon start`
  - writes working status, result text, or rejection text
  - ignores unchanged clipboard content
- Local control app is implemented:
  - `src/app/control-panel.ts`
  - `conduit app start`
  - `npm run app`
  - status/session/run APIs
  - session create/revoke UI
  - recent runs UI
  - clipboard check-once action
- Local macOS menu-bar app scaffold is implemented:
  - `macos/ConduitMenuBar/Package.swift`
  - `macos/ConduitMenuBar/Sources/ConduitMenuBar/main.swift`
  - `script/build_and_run.sh`
  - `npm run macos:build`
  - `npm run macos:run`
  - status item controls for the control app and clipboard daemon
  - default startup for the control app and clipboard daemon
  - confirmed quit that stops supervised services
  - update-check menu path using `website/releases/conduit-appcast.json` or `CONDUIT_UPDATE_MANIFEST_URL`
  - Copy Agent Handshake menu action for real chat-tab testing
- Static web presence is implemented:
  - `website/index.html`
  - `website/download.html`
  - `website/about.html`
  - `website/api.html`
  - `npm run site:dev`
- Core tool coverage is implemented:
  - `tests/tools/file-list.test.ts`
  - `tests/tools/git-tools.test.ts`
  - `tests/tools/write-patch-shell.test.ts`
  - coverage for `file.list`, `git.status`, `git.diff`, `file.write`, `file.patch`, and `shell.run`
- End-to-end smoke coverage is implemented:
  - `tests/e2e/cli-e2e.test.ts`
  - public CLI `doctor`, fake `run`, and `session create/list/revoke`
  - existing app tests cover session creation, exact envelope clipboard check, result writes, and run listing through the local app API
- Static-site coverage is implemented:
  - `tests/website/web-presence.test.ts`
  - required page existence, local link integrity, and public API security copy
- macOS package scaffold coverage is implemented:
  - `tests/macos/menu-bar-package.test.ts`
  - SwiftPM package layout, build script, Codex Run action, and update manifest shape
- Agent-loop handshake generation is implemented:
  - `src/protocol/render-agent-handshake.ts`
  - `POST /api/agent-handshake`
  - control app toolbar button
  - menu-bar `Copy Agent Handshake` action
  - creates an `extension` session and copies a self-contained protocol intro for a real chat tab
- Persistent extension listener session enforcement is implemented:
  - `npm run conduit -- listen --project ...` requires valid `extension` or `browser-yolo` session id and current nonce before action execution
  - successful extension listener actions consume and rotate the nonce
  - extension listener results return `CONDUIT_RESULTS_JSON` with `nextNonce`
  - missing/invalid/replayed session data returns `CONDUIT_REPAIR_JSON`
  - `conduit-handshake-request` is detected but never auto-pairs; it asks for local user approval via Copy Agent Handshake
- Structured repair output is implemented:
  - rejected exact envelopes return `CONDUIT_REPAIR_JSON`
  - malformed JSON, multiple envelopes, missing session/nonce, and invalid session failures include repair instructions and an example request
  - clipboard watcher writes repair output back instead of plain rejection text when available

Verification commands:

```txt
npm install
npm run build
npm test
npm run doctor
npm run spike
npm run macos:build
```

Known-good verification from the latest README cleanup pass:

```txt
npm run build  # passed
npm test       # passed, 22 files / 99 tests
npm run doctor # passed
```

## Completed Gate: GitHub Repository

The repository is initialized and pushed to:

```txt
https://github.com/jon-vs-moloch/conduit
```

## Completed Gate: Session And Nonce Layer

Implemented:

```txt
src/sessions/nonce.ts
src/sessions/session-store.ts
src/sessions/profiles.ts
tests/sessions/session-store.test.ts
```

Behavior:

- `createSession({ label, profile, roots, transport })`
- cryptographically random `sessionId`
- cryptographically random `currentNonce`
- validate `sessionId + nonce`
- consume nonce before execution
- rotate to a new nonce after acceptance
- reject stale, unknown, expired, paused, and revoked sessions
- write session state to `~/.conduit/sessions.json`
- support `CONDUIT_STATE_DIR` in tests

CLI shape:

```txt
conduit session create --label "ChatGPT" --profile read-only --root /path/to/project
conduit session list
conduit session revoke <sessionId>
```

The create command prints a starter `conduit` block containing `sessionId` and `nonce`. It currently uses an empty `actions: []` as a template, which is intentionally not executable because the request schema requires at least one action. Before a polished UX pass, either label this more explicitly as a template or print a concrete safe example action.

## Completed Gate: Real Policy Engine

Policy decision primitives are now implemented and covered by tests.

Implemented:

```txt
src/policy/policy-engine.ts
src/policy/risk.ts
src/policy/budgets.ts
tests/policy/policy-engine.test.ts
```

Decision type:

```ts
type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'requires_review'; reason: string }
  | { decision: 'requires_confirmation'; reason: string }
  | { decision: 'deny'; reason: string };
```

Profiles:

- `read-only`: allow `file.read`, `file.list`, `git.status`, `git.diff`; deny write/patch/shell.
- `edit-with-confirmation`: auto-allow read/git; confirm write/patch; deny shell.
- `shell-manual`: auto-allow read/git; confirm write/patch/shell.

Runtime integration:

```txt
src/runtime/run-loop.ts
src/runtime/listen-loop.ts
```

Both now call the shared executor, which logs `policy-decisions.jsonl` and routes denies/confirmations through tool results.

## Completed Gate: Request Executor Core

Implemented:

```txt
src/runtime/execute-actions.ts
src/runtime/run-loop.ts
src/runtime/listen-loop.ts
```

Behavior:

- log actions
- apply policy
- log policy decisions
- look up tools
- ask confirmation when needed
- execute tools
- append results
- return `ToolResult[]`

This should make the clipboard watcher and future daemon much easier to add. A future `src/daemon/execute-request.ts` can wrap this lower-level executor with session/nonce consumption and result rendering.

## Completed Gate: Trusted Request Executor

Implemented:

```txt
src/daemon/execute-request.ts
tests/daemon/execute-request.test.ts
```

Behavior:

- ignores ordinary text
- rejects malformed, embedded, or multiple request blocks
- rejects requests without `sessionId` and `nonce`
- requires clipboard metadata: `schema`, `source`, and `permissions`
- validates session nonce
- consumes nonce before execution
- executes actions through `src/runtime/execute-actions.ts`
- returns and writes Conduit-native result text
- rejects replayed requests because the nonce is already used

This is the core the clipboard watcher should call after detecting changed clipboard text.

## Completed Gate: Clipboard Watcher MVP

Implemented:

```txt
src/daemon/clipboard-io.ts
src/daemon/clipboard-watcher.ts
src/daemon/daemon.ts
tests/daemon/clipboard-watcher.test.ts
```

Behavior:

- poll `pbpaste` every 500-1000ms on macOS
- hash last clipboard content
- ignore unchanged content
- pass changed clipboard text to `executeRequestFromText`
- write a working status to clipboard immediately
- replace clipboard with rendered results
- never re-execute the same nonce or request hash

CLI:

```txt
conduit daemon once
conduit daemon start --interval-ms 1000
```

`daemon once` reads the clipboard once, executes an exact envelope if present, writes result/rejection text, and exits. `daemon start` keeps polling until Ctrl+C.

## Completed Gate: Local Control App MVP

Implemented:

```txt
src/app/control-panel.ts
tests/app/control-panel.test.ts
```

CLI:

```txt
conduit app start --port 47831 --open
npm run app
```

Current surface:

- status view with Compliance mode and exact-envelope state
- sessions view with create/revoke actions
- starter envelope display for new sessions
- recent runs view
- result viewer for request/agent runs
- check clipboard once action

This is intentionally a local web control plane for now. It gives v0 a usable app surface without blocking on Tauri packaging.

## Completed Gate: Core Tool Coverage

Implemented:

```txt
tests/tools/file-list.test.ts
tests/tools/git-tools.test.ts
tests/tools/write-patch-shell.test.ts
```

Covered behavior:

- `file.list` returns deterministic project-root listings, supports shallow recursive scans, and enforces project-root boundaries.
- `git.status` and `git.diff` work in a real temporary repository.
- `file.write` creates files under the project root and rejects paths outside the root.
- `file.patch` applies unified patches and rejects paths outside the root.
- `shell.run` executes explicit shell commands in the project root and captures stdout/stderr/exit code.

## Completed Gate: End-To-End Smoke Coverage

Implemented:

```txt
tests/e2e/cli-e2e.test.ts
```

Covered behavior:

- `conduit doctor` reports the public runtime surface.
- `conduit run --transport fake` completes a real child-process run and writes final run logs under `CONDUIT_STATE_DIR`.
- `conduit session create/list/revoke` works through the public CLI, prints a valid starter envelope, persists the session, and records revocation.

The local app tests also exercise the request path end to end through app APIs:

- create a session
- place an exact Conduit envelope in a fake clipboard
- call `POST /api/clipboard/check`
- execute via the trusted request executor
- write `CONDUIT_RESULTS_JSON`
- list the resulting run

## Completed Gate: Static Web Presence MVP

Implemented:

```txt
website/index.html
website/download.html
website/about.html
website/api.html
website/assets/site.css
website/assets/conduit-preview.svg
tests/website/web-presence.test.ts
```

Dev preview:

```txt
npm run site:dev
```

The site is intentionally static for v0: home, download, about, and API pages. The download page currently points at source-checkout usage until packaged release artifacts exist.

## Completed Gate: Local macOS Menu-Bar App Scaffold

Implemented:

```txt
macos/ConduitMenuBar/Package.swift
macos/ConduitMenuBar/Sources/ConduitMenuBar/main.swift
macos/ConduitMenuBar/Assets/ConduitIcon.svg
script/build_and_run.sh
.codex/environments/environment.toml
website/releases/conduit-appcast.json
tests/macos/menu-bar-package.test.ts
```

Commands:

```txt
npm run macos:build
npm run macos:run
./script/build_and_run.sh --verify
```

Behavior:

- builds a SwiftPM AppKit status-bar app
- stages `dist/macos/Conduit.app`
- starts/stops `npm run conduit -- app start --port 47831`
- opens `http://127.0.0.1:47831`
- starts/stops `npm run conduit -- listen --project <repo root>` for the browser extension agent loop
- starts/stops `npm run conduit -- daemon start --interval-ms 1000`
- starts supervised services by default when the menu-bar app launches
- asks for confirmation before quitting and stopping supervised services
- passes a parent PID deadman switch to supervised services, so they exit if the menu-bar app disappears
- sweeps legacy service processes from the same checkout when using the local build/run script
- checks a local update manifest by default
- allows `CONDUIT_UPDATE_MANIFEST_URL` to point at a future hosted manifest
- copies a fresh agent-loop handshake into the clipboard for real ChatGPT tab testing

Important limitation:

- this is a local preview app, not a signed/notarized distributable
- update checking can find and open an artifact URL, but does not self-replace the app bundle yet
- the local preview manifest is intentionally unsigned; production releases should use signed artifacts and a real manifest signature story
- the handshake creates a paired agent-loop session, but extension-side session/nonce enforcement still needs to be wired before YOLO-style execution is trusted

## Next Gate 3: Signed Desktop/Menu-Bar Release

We want an app, too. The CLI daemon can prove the execution loop first, but v0 should include a small local control surface rather than remaining terminal-only.

Recommended scope:

```txt
app/
  signed native menu-bar app
```

The app should own consent and visibility:

- daemon status: running, paused, stopped
- current mode: Compliance, YOLO, Idiot/unsafe
- obvious warning when any embedded-block parser setting is enabled
- session list with labels, profiles, roots, current state, and revoke action
- recent runs list with status, source, actions, and log path
- pending confirmation dialog for write/patch/shell actions
- copy/view latest result
- settings for clipboard watcher polling and exact-envelope behavior

Keep first release version modest:

- no native extension pairing UI beyond showing status/token if needed
- no marketplace/release-channel work
- no broad installer story

The app is the control/consent plane. The daemon owns execution. The CLI remains useful for scripting and tests.

## Completed Gate: Native Result Blocks

Current agent-loop result rendering is still ChatGPT/Veyr-compatible:

```txt
<<<TOOL_RESULTS_JSON
...
TOOL_RESULTS_JSON>>>
```

Conduit-native request execution now renders:

```txt
<<<CONDUIT_RESULTS_JSON
...
CONDUIT_RESULTS_JSON>>>
```

Keep `TOOL_RESULTS_JSON` as a compatibility mode for chat agent loops.

## Notes

- The browser extension now recognizes fenced `conduit` blocks, but its rendered-code fallback intentionally scans only the longer labels (`conduit-call`, `conduit-final`, `veyr-call`, `veyr-final`) to avoid prefix collisions. If rendered fallback for bare `conduit` becomes necessary, add boundary-aware matching rather than a plain substring search.
- Keep the distinction sharp: `parseClipboardEnvelope` is for Compliance Mode clipboard/daemon execution; `parseActions` is for authenticated agent-loop turns only after the user has explicitly started or paired that transport, or enabled a YOLO/unsafe embedded-block setting.
- `npm install` reports 5 moderate vulnerabilities inherited from the current dependency graph. Do not run `npm audit fix --force` casually; it may introduce breaking upgrades.
- `dist/` is generated by `npm run build`. Do not edit generated files.

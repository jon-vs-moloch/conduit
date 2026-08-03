# Desktop shell contract: local acceptance checkpoint

**Source:** `25edcb93887ea6014ab7b763d2506df27b0cf0e3` on `main`  
**Observed:** 2026-08-02  
**Scope:** deterministic local source/package acceptance only; no credentials,
external service, or packaged-platform execution was used.

## Result

The shared desktop-shell contract has local evidence for its control-plane and
redaction surfaces, but it is **not a cross-platform release acceptance
receipt**.

```sh
npm test -- --run tests/platforms/cross-platform-package.test.ts \
  tests/macos/menu-bar-package.test.ts tests/app/control-panel.test.ts
npm run build
```

Both commands exited `0` at the source above. The selected Vitest files passed
**17 tests** and TypeScript compiled successfully.

## Claim evidence

| Contract cluster | Local deterministic result | Evidence |
| --- | --- | --- |
| Required controls | PASS (source/package scope) | `tests/platforms/cross-platform-package.test.ts` checks shared contract, Windows/Linux launchers and packages; `tests/macos/menu-bar-package.test.ts` checks the menu-bar controls and local control endpoints; `tests/app/control-panel.test.ts` exercises `/api/status` and the agent-handshake/control panel surface. |
| Safety behavior | PARTIAL | The control-panel test exercises a redacted diagnostic bundle and the macOS/package tests assert quit/control wiring. No Windows/Linux/macOS packaged binary was launched, so quit supervision, child termination, and preview-before-send are not release-accepted on all platforms. |

## Remaining blocker

Do not mark the whole advertised shell contract PASS until CI or a controlled
local matrix executes the packaged macOS, Windows, and Linux shells and proves:

1. default-start/confirmed-quit child supervision;
2. `CONDUIT_PARENT_PID` on every spawned child; and
3. diagnostic preview/redaction before a user can send or attach it.

The current result is deliberately source-level evidence, not evidence that a
binary on every target platform behaves as advertised.

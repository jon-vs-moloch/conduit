# Conduit Desktop Shell Contract

Every platform shell is a small native wrapper around the same local Conduit
control plane. The shell may be Swift/AppKit, WinUI, GTK, Tauri, or another
native wrapper, but the user-facing contract should stay consistent.

Required controls:

- Start/stop Control App: `conduit app start --port 47831`
- Start/stop Agent Listener: `conduit listen --project <root>`
- Start/stop Clipboard Daemon: `conduit daemon start --interval-ms 1000`
- Open Control Panel: `http://127.0.0.1:47831`
- Open Approvals: `http://127.0.0.1:47831#approvals`
- Report Bug: `http://127.0.0.1:47831#diagnostics`
- Copy Agent Handshake: `POST http://127.0.0.1:47831/api/agent-handshake`
- Check Control Health: `GET http://127.0.0.1:47831/api/status`
- Check Agent Bridge: `GET http://127.0.0.1:3333/health`
- Check Diagnostics: `GET http://127.0.0.1:47831/api/diagnostics`

Required safety behavior:

- Default-start local services when the app starts.
- Confirm quit and clearly distinguish quit from minimize-to-tray/status-area.
- Stop supervised child processes on confirmed quit.
- Child processes must receive `CONDUIT_PARENT_PID` when the shell supervises
  them.
- A Report Bug action must preview a redacted diagnostic bundle before the user
  sends or attaches it.
- Do not silently attach clipboard contents, request payloads, file contents,
  session nonces, API keys, environment variables, credentials, or
  secret-looking values.

Platform packaging targets:

- macOS: DMG containing `Conduit.app` and an Applications shortcut.
- Windows: signed installer eventually; preview package may be a zip containing
  launchers and shell assets.
- Linux: AppImage/deb/rpm eventually; preview package may be a tarball
  containing launchers and `.desktop` metadata.

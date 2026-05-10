# Conduit For Linux

Linux is a first-class Conduit desktop target. The preview package starts as a
tarball that carries the built TypeScript runtime, launcher scripts, and
`.desktop` metadata. A later native shell should become a tray/status app using
the shared desktop-shell contract.

Preview package contents:

- `bin/conduit-control`: starts the local control panel on port `47831`
- `bin/conduit-agent-listener`: starts the browser bridge listener on port
  `3333`
- `bin/conduit-clipboard-daemon`: starts exact-envelope clipboard monitoring
- `bin/conduit-open-control`: opens the control panel
- `bin/conduit-report-bug`: opens the redacted diagnostics view
- `share/applications/conduit.desktop`: launcher metadata
- `README.txt`: install notes and current limitations

Native tray/status shell requirements:

- show control/listener/daemon status
- default-start supervised services
- ask whether quit means stop services or minimize to tray/status area
- open approvals and bug-report diagnostics
- copy agent handshakes through `/api/agent-handshake`
- set `CONDUIT_PARENT_PID` for supervised child processes

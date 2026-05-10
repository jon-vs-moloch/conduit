# Conduit For Windows

Windows is a first-class Conduit desktop target. The preview package starts as a
zip that carries the built TypeScript runtime plus PowerShell launchers. A later
native shell should turn those launchers into a tray app with the same contract
as macOS.

Preview package contents:

- `Conduit-Control.ps1`: starts the local control panel on port `47831`
- `Conduit-Agent-Listener.ps1`: starts the browser bridge listener on port
  `3333`
- `Conduit-Clipboard-Daemon.ps1`: starts exact-envelope clipboard monitoring
- `Conduit-Open-Control.ps1`: opens the control panel
- `Conduit-Report-Bug.ps1`: opens the redacted diagnostics view
- `README.txt`: install notes and current limitations

Native tray shell requirements:

- show control/listener/daemon status
- default-start supervised services
- ask whether quit means stop services or minimize to tray
- open approvals and bug-report diagnostics
- copy agent handshakes through `/api/agent-handshake`
- set `CONDUIT_PARENT_PID` for supervised child processes

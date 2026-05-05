export function startParentWatchdogFromEnv(): void {
  const rawParentPid = process.env.CONDUIT_PARENT_PID;
  if (!rawParentPid) {
    return;
  }

  const parentPid = Number.parseInt(rawParentPid, 10);
  if (!Number.isFinite(parentPid) || parentPid <= 1) {
    console.error(`[Conduit watchdog] Invalid CONDUIT_PARENT_PID: ${rawParentPid}`);
    process.exit(1);
  }

  const interval = setInterval(() => {
    if (!isProcessAlive(parentPid)) {
      console.error(`[Conduit watchdog] Parent process ${parentPid} is gone. Stopping Conduit service.`);
      process.exit(0);
    }
  }, 1000);
  interval.unref();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

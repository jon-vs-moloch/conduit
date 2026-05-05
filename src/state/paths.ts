import os from 'node:os';
import path from 'node:path';

export function getStateRoot(): string {
  return process.env.CONDUIT_STATE_DIR ?? path.join(os.homedir(), '.conduit');
}

export function getRunsRoot(): string {
  return path.join(getStateRoot(), 'runs');
}

export function getRunDir(runId: string): string {
  return path.join(getRunsRoot(), runId);
}

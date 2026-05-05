import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('parent watchdog', () => {
  it('exits supervised CLI services when the parent pid is gone', async () => {
    const child = spawn(path.resolve('node_modules/.bin/tsx'), [
      '-e',
      [
        'import { startParentWatchdogFromEnv } from "./src/cli/parent-watchdog.ts";',
        'startParentWatchdogFromEnv();',
        'setTimeout(() => process.exit(99), 5000);'
      ].join('\n')
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONDUIT_PARENT_PID: '999999'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    expect(exitCode).toBe(0);
  });
});

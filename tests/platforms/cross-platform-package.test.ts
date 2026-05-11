import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cross-platform desktop package scaffolds', () => {
  it('defines the shared desktop shell contract', async () => {
    const contract = await readText('platforms/desktop-shell-contract.md');
    expect(contract).toContain('Report Bug');
    expect(contract).toContain('http://127.0.0.1:47831#diagnostics');
    expect(contract).toContain('/api/agent-handshake');
    expect(contract).toContain('CONDUIT_PARENT_PID');
    expect(contract).toContain('Windows: signed installer eventually');
    expect(contract).toContain('Linux: AppImage/deb/rpm eventually');
  });

  it('ships Windows preview launchers and packaging script', async () => {
    await expectExists('script/package_windows.ps1');
    await expectExists('script/package_windows.mjs');
    await expectExists('platforms/windows/Conduit-Control.ps1');
    await expectExists('platforms/windows/Conduit-Agent-Listener.ps1');
    await expectExists('platforms/windows/Conduit-Clipboard-Daemon.ps1');
    await expectExists('platforms/windows/Conduit-Open-Control.ps1');
    await expectExists('platforms/windows/Conduit-Report-Bug.ps1');

    const script = await readText('script/package_windows.ps1');
    expect(script).toContain('Conduit-win-x64.zip');
    expect(script).toContain('Compress-Archive');
    expect(script).toContain('runtime/dist/src');
    expect(script).not.toContain('Copy-Item -Recurse (Join-Path $Root "dist")');
    expect(script).toContain('desktop-shell-contract.md');
    expect(script).toContain('Conduit-Report-Bug.ps1');
    expect(script).toContain('npm install --omit=dev');

    const nodeScript = await readText('script/package_windows.mjs');
    expect(nodeScript).toContain('Conduit-win-x64.zip');
    expect(nodeScript).toContain("'runtime', 'dist', 'src'");
    expect(nodeScript).toContain('desktop-shell-contract.md');
    expect(nodeScript).toContain('Conduit-Report-Bug.ps1');
    expect(nodeScript).toContain('npm install --omit=dev');

    const reportBug = await readText('platforms/windows/Conduit-Report-Bug.ps1');
    expect(reportBug).toContain('http://127.0.0.1:47831#diagnostics');

    const control = await readText('platforms/windows/Conduit-Control.ps1');
    expect(control).toContain('CONDUIT_PARENT_PID');
    expect(control).toContain('runtime/dist/src/cli/index.js');
    expect(control).toContain('app start --port 47831');
  });

  it('ships Linux preview launchers, desktop metadata, and packaging script', async () => {
    await expectExists('script/package_linux.sh');
    await expectExists('platforms/linux/bin/conduit-control');
    await expectExists('platforms/linux/bin/conduit-agent-listener');
    await expectExists('platforms/linux/bin/conduit-clipboard-daemon');
    await expectExists('platforms/linux/bin/conduit-open-control');
    await expectExists('platforms/linux/bin/conduit-report-bug');
    await expectExists('platforms/linux/share/applications/conduit.desktop');

    const script = await readText('script/package_linux.sh');
    expect(script).toContain('conduit-linux-x64.tar.gz');
    expect(script).toContain('runtime/dist/src');
    expect(script).not.toContain('cp -R "$ROOT/dist"');
    expect(script).toContain('desktop-shell-contract.md');
    expect(script).toContain('conduit-report-bug');
    expect(script).toContain('npm install --omit=dev');
    expect(script).toContain('tar -C "$DIST_DIR" -czf');

    const reportBug = await readText('platforms/linux/bin/conduit-report-bug');
    expect(reportBug).toContain('xdg-open');
    expect(reportBug).toContain('http://127.0.0.1:47831#diagnostics');

    const desktop = await readText('platforms/linux/share/applications/conduit.desktop');
    expect(desktop).toContain('Name=Conduit');
    expect(desktop).toContain('Exec=conduit-open-control');
  });

  it('exposes package scripts for every desktop target', async () => {
    const packageJson = JSON.parse(await readText('package.json'));
    expect(packageJson.scripts['macos:package']).toBe('./script/package_dmg.sh');
    expect(packageJson.scripts['windows:package']).toBe('node ./script/package_windows.mjs');
    expect(packageJson.scripts['linux:package']).toBe('./script/package_linux.sh');
  });
});

async function expectExists(file: string): Promise<void> {
  await expect(access(path.resolve(file))).resolves.toBeUndefined();
}

async function readText(file: string): Promise<string> {
  return readFile(path.resolve(file), 'utf8');
}

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macOS menu-bar package scaffold', () => {
  it('ships a SwiftPM menu-bar app and build script', async () => {
    await expectExists('macos/ConduitMenuBar/Package.swift');
    await expectExists('macos/ConduitMenuBar/Sources/ConduitMenuBar/main.swift');
    await expectExists('macos/ConduitMenuBar/Assets/ConduitIcon.svg');
    await expectExists('script/build_and_run.sh');

    const main = await readText('macos/ConduitMenuBar/Sources/ConduitMenuBar/main.swift');
    expect(main).toContain('NSStatusBar.system.statusItem');
    expect(main).toContain('Start Clipboard Daemon');
    expect(main).toContain('Start Agent Listener');
    expect(main).toContain('startDaemon()');
    expect(main).toContain('startAgentListener()');
    expect(main).toContain('startControlApp()');
    expect(main).toContain('applicationShouldTerminate');
    expect(main).toContain('Copy Agent Handshake');
    expect(main).toContain('/api/agent-handshake');
    expect(main).toContain('NSPasteboard.general');
    expect(main).toContain('Quit and Stop Services');
    expect(main).toContain('Keep Running');
    expect(main).toContain('pkill');
    expect(main).toContain('Check for Updates');
    expect(main).toContain('Open Logs');
    expect(main).toContain('Logs/Conduit');
    expect(main).toContain('/api/status');
    expect(main).toContain('Control App Already Running');
    expect(main).toContain('Control App Needs Restart');
    expect(main).toContain('agentHandshake');
    expect(main).toContain('restartStaleControlApp');
    expect(main).toContain('listenerPids(on: 47831)');
    expect(main).toContain('listenerPids(on: 3333)');
    expect(main).toContain('isConduitControlListener');
    expect(main).toContain('isConduitAgentListener');
    expect(main).toContain('agent-listener.log');
    expect(main).toContain('"listen", "--project"');
    expect(main).toContain('standardOutput = handle');
    expect(main).toContain('standardError = handle');
    expect(main).toContain('/bin/zsh');
    expect(main).toContain('nvm.sh');
    expect(main).toContain('exec \\(command)');
    expect(main).toContain('CONDUIT_PARENT_PID');
    expect(main).toContain('/opt/homebrew/bin');
    expect(main).toContain('CONDUIT_UPDATE_MANIFEST_URL');
    expect(main).toContain('CONDUIT_REPO_ROOT');

    const script = await readText('script/build_and_run.sh');
    expect(script).toContain('SWIFT_BUILD_DIR="${CONDUIT_SWIFT_BUILD_DIR:-${TMPDIR:-/tmp}/conduit-menubar-build}"');
    expect(script).toContain('swift build --package-path "$PACKAGE_DIR" --scratch-path "$SWIFT_BUILD_DIR"');
    expect(script).toContain('src/cli/index.ts daemon start');
    expect(script).toContain('src/cli/index.ts listen --project');
    expect(script).toContain('LSUIElement');
    expect(script).toContain('CONDUIT_REPO_ROOT="$ROOT" /usr/bin/open -n "$APP_BUNDLE"');
  });

  it('ships a local update manifest with release-artifact metadata', async () => {
    const text = await readText('website/releases/conduit-appcast.json');
    const manifest = JSON.parse(text);
    expect(manifest).toMatchObject({
      schema: 'conduit.update-manifest.v1',
      version: '0.0.1',
      channel: 'local-preview'
    });
    expect(manifest.artifacts[0]).toMatchObject({
      platform: 'macos-universal',
      sha256: 'local-preview-placeholder'
    });
    expect(manifest.artifacts[0].url).toContain('Conduit.zip');
  });

  it('exposes package scripts and a Codex run action for local launch', async () => {
    const packageJson = JSON.parse(await readText('package.json'));
    expect(packageJson.scripts['macos:build']).toBe('./script/build_and_run.sh --build-only');
    expect(packageJson.scripts['macos:run']).toBe('./script/build_and_run.sh');

    const environment = await readText('.codex/environments/environment.toml');
    expect(environment).toContain('[actions.Run]');
    expect(environment).toContain('./script/build_and_run.sh');
  });
});

async function expectExists(file: string): Promise<void> {
  await expect(access(path.resolve(file))).resolves.toBeUndefined();
}

async function readText(file: string): Promise<string> {
  return readFile(path.resolve(file), 'utf8');
}

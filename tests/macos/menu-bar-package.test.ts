import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('macOS menu-bar package scaffold', () => {
  it('ships a SwiftPM menu-bar app and build script', async () => {
    await expectExists('macos/ConduitMenuBar/Package.swift');
    await expectExists('macos/ConduitMenuBar/Sources/ConduitMenuBar/main.swift');
    await expectExists('macos/ConduitMenuBar/Assets/ConduitIcon.svg');
    await expectExists('script/build_and_run.sh');
    await expectExists('script/package_dmg.sh');

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
    expect(main).toContain('Report Bug');
    expect(main).toContain('openDiagnostics');
    expect(main).toContain('#diagnostics');
    expect(main).toContain('redacted diagnostic bundle');
    expect(main).toContain('Logs/Conduit');
    expect(main).toContain('/api/status');
    expect(main).toContain('http://127.0.0.1:3333/health');
    expect(main).toContain('needs attention');
    expect(main).toContain('UNUserNotificationCenter');
    expect(main).toContain('refreshApprovalNotifications');
    expect(main).toContain('/api/approvals');
    expect(main).toContain('Conduit approval required');
    expect(main).toContain('openApprovals');
    expect(main).toContain('#approvals');
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
    expect(main).toContain('dist/macos/conduit-appcast.json');
    expect(main).toContain('website/releases/conduit-appcast.json');

    const script = await readText('script/build_and_run.sh');
    expect(script).toContain('SWIFT_BUILD_DIR="${CONDUIT_SWIFT_BUILD_DIR:-${TMPDIR:-/tmp}/conduit-menubar-build}"');
    expect(script).toContain('swift build --package-path "$PACKAGE_DIR" --scratch-path "$SWIFT_BUILD_DIR"');
    expect(script).toContain('src/cli/index.ts daemon start');
    expect(script).toContain('src/cli/index.ts listen --project');
    expect(script).toContain('LSUIElement');
    expect(script).toContain('CONDUIT_REPO_ROOT="$ROOT" /usr/bin/open -n "$APP_BUNDLE"');

    const packageScript = await readText('script/package_dmg.sh');
    expect(packageScript).toContain('hdiutil create');
    expect(packageScript).toContain('Conduit.dmg');
    expect(packageScript).toContain('--skip-build');
    expect(packageScript).toContain('ln -s /Applications');
    expect(packageScript).toContain('README.txt');
    expect(packageScript).toContain('shasum -a 256');
    expect(packageScript).toContain('conduit-appcast.json');
    expect(packageScript).toContain('CONDUIT_DMG_SHA256');
    expect(packageScript).toContain('CONDUIT_RELEASE_ARTIFACT_URL');
    expect(packageScript).toContain('CONDUIT_RELEASE_BASE_URL');
    expect(packageScript).toContain('CONDUIT_RELEASE_CHANNEL');
    expect(packageScript).toContain('CONDUIT_DMG_SIZE_BYTES');
    expect(packageScript).toContain('RELEASE_NOTES.txt');
    expect(packageScript).toContain("new URL('file://' + process.argv[1]).href");
    expect(packageScript).toContain('Local preview DMG generated from this checkout');
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
      sha256: 'local-preview-sha256-published-with-release',
      sizeBytes: 0
    });
    expect(manifest.artifacts[0].url).toContain('Conduit.dmg');
  });

  it('loads the extension on ChatGPT origins and permits localhost bridge access', async () => {
    const manifest = JSON.parse(await readText('extension/manifest.json'));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      'http://127.0.0.1:3333/*',
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://chat.openai.com/*'
    ]));
    expect(manifest.action).toMatchObject({
      default_popup: 'popup.html'
    });
    expect(manifest.content_scripts[0].matches).toEqual(expect.arrayContaining([
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://chat.openai.com/*'
    ]));

    const background = await readText('extension/background.js');
    const content = await readText('extension/content.js');
    const popup = await readText('extension/popup.js');
    expect(background).toContain('/api/conduit-tab-status');
    expect(content).toContain('content_script_alive');
    expect(content).toContain('outbound_received');
    expect(content).toContain("['conduit', 'conduit-call'");
    expect(content).toContain('safeSendMessage');
    expect(content).toContain('getRuntimeLastError');
    expect(content).toContain('scheduleOutboundPoll');
    expect(content).toContain('Extension context invalidated');
    expect(content).toContain('decorateProtocolBlocks');
    expect(content).toContain('conduit-protocol-header');
    expect(content).toContain('Local execution requires Conduit desktop');
    expect(popup).toContain('/api/conduit-retry');
    expect(popup).toContain('attentionOutboundIds');
    expect(popup).toContain('Retry available');
    expect(popup).toContain('bridgeCanRetry');
    expect(popup).toContain('tabAvailabilityLabel');
    expect(popup).toContain('unavailable');
    const popupHtml = await readText('extension/popup.html');
    expect(popupHtml).toContain('Desktop app not connected');
    expect(popupHtml).toContain('https://github.com/jon-vs-moloch/conduit');
    expect(popupHtml).toContain('Report Bug');
    expect(popupHtml).toContain('http://127.0.0.1:47831#diagnostics');
  });

  it('exposes package scripts and a Codex run action for local launch', async () => {
    const packageJson = JSON.parse(await readText('package.json'));
    expect(packageJson.scripts['macos:build']).toBe('./script/build_and_run.sh --build-only');
    expect(packageJson.scripts['macos:run']).toBe('./script/build_and_run.sh');
    expect(packageJson.scripts['macos:package']).toBe('./script/package_dmg.sh');

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

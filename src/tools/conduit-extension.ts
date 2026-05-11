import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_EXTENSION_URL = 'https://owlandkestrel.com/releases/conduit/conduit-bridge-extension.zip';
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  'owlandkestrel.com',
  'www.owlandkestrel.com',
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
]);

const ConduitExtensionPrepareAlphaInstallArgsSchema = z.object({
  url: z.string().url().optional(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  openExtensionsPage: z.boolean().default(true)
}).passthrough();

type Args = z.infer<typeof ConduitExtensionPrepareAlphaInstallArgsSchema>;

export const conduitExtensionPrepareAlphaInstallTool: ToolDefinition<Args> = {
  name: 'conduit.extension.prepareAlphaInstall',
  description: 'Download or build the alpha browser extension package, extract it, and open the browser extension settings page for developer-mode installation.',
  risk: 'low',
  schema: ConduitExtensionPrepareAlphaInstallArgsSchema,
  async run(args, context) {
    const workDir = path.join(os.homedir(), 'Downloads', 'Conduit');
    const zipPath = path.join(workDir, 'conduit-bridge-extension.zip');
    const extractRoot = path.join(workDir, 'conduit-bridge-extension');
    const url = args.url ?? process.env.CONDUIT_EXTENSION_ALPHA_URL ?? DEFAULT_EXTENSION_URL;

    await mkdir(workDir, { recursive: true });
    const source = await resolveExtensionZip(url, context.projectRoot);
    await copyFile(source.path, zipPath);

    const actualSha256 = await sha256File(zipPath);
    if (args.sha256 && actualSha256.toLowerCase() !== args.sha256.toLowerCase()) {
      throw new Error(`Extension package hash mismatch: expected ${args.sha256}, got ${actualSha256}.`);
    }

    await rm(extractRoot, { recursive: true, force: true });
    await execFileAsync('/usr/bin/unzip', ['-oq', zipPath, '-d', workDir]);
    await ensureExtractedExtension(extractRoot);

    let openedExtensionsPage = false;
    if (args.openExtensionsPage && process.platform === 'darwin') {
      await execFileAsync('/usr/bin/open', ['chrome://extensions/']);
      openedExtensionsPage = true;
    }

    return {
      content: {
        zipPath,
        extensionFolder: extractRoot,
        sha256: actualSha256,
        source: source.label,
        openedExtensionsPage,
        nextSteps: [
          'Enable Developer mode in Chrome or Brave.',
          `Choose Load unpacked and select ${extractRoot}.`,
          'Reload your ChatGPT tab.'
        ],
        note: args.sha256
          ? 'Package hash matched the request.'
          : 'No hash was provided; this alpha helper only prepares the developer-mode package.'
      },
      metadata: {
        zipPath,
        extensionFolder: extractRoot,
        sha256: actualSha256,
        openedExtensionsPage
      }
    };
  }
};

async function resolveExtensionZip(url: string, projectRoot: string): Promise<{ path: string; label: string }> {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') {
    if (process.env.CONDUIT_ALLOW_FILE_EXTENSION_PACKAGES !== '1') {
      throw new Error('Local file extension packages require CONDUIT_ALLOW_FILE_EXTENSION_PACKAGES=1.');
    }
    const filePath = fileURLToPath(parsed);
    await assertReadableFile(filePath);
    return { path: filePath, label: url };
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Extension package URL must use https:// or file://.');
  }
  if (!TRUSTED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`Extension package host is not trusted for alpha installs: ${parsed.hostname}`);
  }

  if (url === DEFAULT_EXTENSION_URL) {
    const local = await maybeBuildLocalPackage(projectRoot);
    if (local) {
      return { path: local, label: 'local extension package from this checkout' };
    }
  }

  const downloadPath = path.join(os.tmpdir(), `conduit-extension-${Date.now()}.zip`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Extension package download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(downloadPath, bytes);
  return { path: downloadPath, label: url };
}

async function maybeBuildLocalPackage(projectRoot: string): Promise<string | null> {
  const scriptPath = path.join(projectRoot, 'script', 'package_extension.sh');
  try {
    await assertReadableFile(scriptPath);
  } catch {
    return null;
  }
  await execFileAsync(scriptPath, [], { cwd: projectRoot });
  const zipPath = path.join(projectRoot, 'dist', 'extension', 'conduit-bridge-extension.zip');
  await assertReadableFile(zipPath);
  return zipPath;
}

async function ensureExtractedExtension(extractRoot: string): Promise<void> {
  const manifestPath = path.join(extractRoot, 'manifest.json');
  await assertReadableFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  if (
    typeof manifest !== 'object'
    || manifest === null
    || (manifest as { name?: unknown }).name !== 'Conduit Bridge'
  ) {
    throw new Error('Extracted package does not look like the Conduit Bridge extension.');
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  await access(filePath);
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`Expected a file: ${filePath}`);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

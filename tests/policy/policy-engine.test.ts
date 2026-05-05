import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolAction } from '../../src/protocol/schemas.js';
import { evaluateActionPolicy, evaluateRequestPolicy } from '../../src/policy/policy-engine.js';
import type { ConduitSession } from '../../src/sessions/session-store.js';

describe('policy engine', () => {
  let tempRoot: string;
  let projectRoot: string;
  let session: ConduitSession;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-policy-'));
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello\n', 'utf8');
    await writeFile(path.join(projectRoot, '.env'), 'TOKEN=secret\n', 'utf8');

    session = {
      sessionId: 'sess_test',
      label: 'Policy test',
      createdAt: new Date().toISOString(),
      state: 'active',
      transport: 'clipboard',
      permissionProfile: 'read-only',
      allowedRoots: [projectRoot],
      currentNonce: 'call_test',
      usedNonces: []
    };
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('allows trusted read-only file reads inside an allowed root', async () => {
    await expect(evaluateActionPolicy({
      session,
      action: action('file.read', { path: 'README.md' })
    })).resolves.toEqual({ decision: 'allow' });
  });

  it('requires review for untrusted requests', async () => {
    await expect(evaluateActionPolicy({
      action: action('file.read', { path: 'README.md' }),
      mode: 'untrusted'
    })).resolves.toEqual({
      decision: 'requires_review',
      reason: 'Request is not attached to a trusted session.'
    });
  });

  it('denies tools disallowed by the active profile', async () => {
    await expect(evaluateActionPolicy({
      session,
      action: action('file.write', { path: 'README.md', content: 'changed', mode: 'overwrite' })
    })).resolves.toEqual({
      decision: 'deny',
      reason: 'Tool denied by read-only profile: file.write'
    });
  });

  it('requires confirmation for edit tools in edit profile', async () => {
    session.permissionProfile = 'edit-with-confirmation';

    await expect(evaluateActionPolicy({
      session,
      action: action('file.write', { path: 'README.md', content: 'changed', mode: 'overwrite' })
    })).resolves.toEqual({
      decision: 'requires_confirmation',
      reason: 'Tool requires confirmation: file.write'
    });
  });

  it('denies reads outside allowed roots', async () => {
    const outsidePath = path.join(tempRoot, 'outside.txt');
    await writeFile(outsidePath, 'nope\n', 'utf8');

    await expect(evaluateActionPolicy({
      session,
      action: action('file.read', { path: outsidePath })
    })).resolves.toEqual({
      decision: 'deny',
      reason: `Path is outside allowed roots: ${outsidePath}`
    });
  });

  it('denies sensitive file reads', async () => {
    await expect(evaluateActionPolicy({
      session,
      action: action('file.read', { path: '.env' })
    })).resolves.toEqual({
      decision: 'deny',
      reason: 'Sensitive file read denied: .env'
    });
  });

  it('denies unknown tools and over-budget requests', async () => {
    await expect(evaluateActionPolicy({
      session,
      action: action('unknown.tool', {})
    })).resolves.toEqual({
      decision: 'deny',
      reason: 'Unknown tool: unknown.tool'
    });

    await expect(evaluateRequestPolicy({
      session,
      actions: [
        action('file.read', { path: 'README.md' }),
        action('file.list', { path: '.' })
      ],
      budgets: { maxActions: 1 }
    })).resolves.toEqual({
      decision: 'deny',
      reason: 'Too many actions: 2 > 1.'
    });
  });
});

function action(tool: string, args: Record<string, unknown>): ToolAction {
  return {
    id: `${tool.replace(/\W/g, '_')}_test`,
    tool,
    args
  };
}

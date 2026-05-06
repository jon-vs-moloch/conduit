import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  conduitBlock,
  conduitFinalBlock,
  runAgentLoopTranscript
} from '../../src/runtime/agent-loop-harness.js';

describe('agent loop transcript harness', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'conduit-agent-loop-e2e-'));
    projectRoot = path.join(tempRoot, 'project');
    process.env.CONDUIT_STATE_DIR = path.join(tempRoot, 'state');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'README.md'), 'hello from transcript harness\n', 'utf8');
  });

  afterEach(async () => {
    delete process.env.CONDUIT_STATE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('runs prose plus compact conduit blocks through nonce rotation and finalization', async () => {
    const transcript = await runAgentLoopTranscript({
      projectRoot,
      steps: [
        {
          label: 'orient',
          assistant: ({ sessionId, nonce }) => [
            'I will first list the project root so I can see what is available.',
            '',
            conduitBlock({
              v: '1',
              session: sessionId,
              n: nonce,
              do: 'list',
              path: '.',
              why: 'Orient before reading files.'
            })
          ].join('\n')
        },
        {
          label: 'read',
          assistant: ({ sessionId, nonce }) => [
            'I found the root. Now I will read the README and check git status.',
            '',
            conduitBlock({
              v: '1',
              session: sessionId,
              n: nonce,
              do: [
                'read README.md',
                'status'
              ],
              why: 'Need context and current working tree state.'
            })
          ].join('\n')
        },
        {
          label: 'final',
          assistant: conduitFinalBlock({
            status: 'complete',
            summary: 'Transcript harness completed.'
          })
        }
      ]
    });

    expect(transcript.turns.map((turn) => turn.status)).toEqual(['actions', 'actions', 'final']);
    expect(transcript.sentMessages).toHaveLength(2);
    expect(transcript.sentMessages[0]).toContain('CONDUIT_RESULTS_JSON');
    expect(transcript.sentMessages[0]).toContain('"nextNonce"');
    expect(transcript.sentMessages[1]).toContain('hello from transcript harness');
    expect(transcript.finalSession.usedNonces).toHaveLength(2);
    expect(transcript.finalSession.currentNonce).not.toBe(transcript.session.currentNonce);
    expect(transcript.listenSession).toBeNull();

    const finalRun = transcript.turns[1]?.runId;
    expect(finalRun).toBeTruthy();
    await expect(readFile(path.join(process.env.CONDUIT_STATE_DIR!, 'runs', finalRun!, 'final.md'), 'utf8'))
      .resolves.toBe('Transcript harness completed.');
  });

  it('recovers from a malformed request by surfacing .help and accepting a help call', async () => {
    const transcript = await runAgentLoopTranscript({
      projectRoot,
      steps: [
        {
          label: 'missing nonce',
          assistant: ({ sessionId }) => [
            'I need to ask Conduit for help, but this first request is intentionally missing its nonce.',
            '',
            conduitBlock({
              v: '1',
              session: sessionId,
              do: 'read',
              path: 'README.md',
              why: 'This should be rejected before execution.'
            })
          ].join('\n')
        },
        {
          label: 'help recovery',
          assistant: ({ sessionId, nonce }) => [
            'The repair says I can ask for protocol examples, so I will request help.',
            '',
            conduitBlock({
              v: '1',
              session: sessionId,
              n: nonce,
              do: '.help',
              topic: 'examples',
              why: 'Need compact request examples.'
            })
          ].join('\n')
        }
      ]
    });

    expect(transcript.turns.map((turn) => turn.status)).toEqual(['protocol_error', 'actions']);
    expect(transcript.sentMessages[0]).toContain('CONDUIT_REPAIR_JSON');
    expect(transcript.sentMessages[0]).toContain('do: "help"');
    expect(transcript.sentMessages[1]).toContain('CONDUIT_RESULTS_JSON');
    expect(transcript.sentMessages[1]).toContain('conduit.help');
    expect(transcript.sentMessages[1]).toContain('"topic": "examples"');
    expect(transcript.finalSession.usedNonces).toHaveLength(1);
  });
});

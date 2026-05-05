import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseActions } from '../protocol/parse-actions.js';
import { parseFinal } from '../protocol/parse-final.js';
import { renderProtocolError, renderToolResults } from '../protocol/render-results.js';
import type { FinalBlock } from '../protocol/schemas.js';
import { getRunDir } from '../state/paths.js';
import { appendJsonl, ensureRunDir, writeTextFile } from '../state/logs.js';
import type { ModelTransport } from '../transports/types.js';
import { createRunId } from '../util/ids.js';
import { executeActions } from './execute-actions.js';
import { buildInitialPrompt } from './prompt-builder.js';

export interface RunInput {
  task: string;
  projectRoot: string;
  transport: ModelTransport;
  maxTurns?: number;
  yes?: boolean;
}

export interface RunOutput {
  runId: string;
  runDir: string;
  final: FinalBlock;
}

export async function runLoop(input: RunInput): Promise<RunOutput> {
  const runId = createRunId();
  const runDir = getRunDir(runId);
  const projectRoot = await realpath(path.resolve(input.projectRoot));
  const maxTurns = input.maxTurns ?? 12;

  await ensureRunDir(runDir);
  await writeTextFile(runDir, 'task.md', input.task);
  await writeTextFile(runDir, 'metadata.json', JSON.stringify({
    runId,
    projectRoot,
    startedAt: new Date().toISOString()
  }, null, 2));

  await input.transport.open();
  await input.transport.ensureReady();

  const initialPrompt = buildInitialPrompt({ task: input.task, projectRoot });
  await input.transport.sendMessage(initialPrompt);
  await appendJsonl(runDir, 'transcript.jsonl', {
    role: 'user',
    text: initialPrompt,
    timestamp: new Date().toISOString()
  });

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const assistantTurn = await input.transport.waitForAssistantTurn();
      await appendJsonl(runDir, 'transcript.jsonl', {
        role: 'assistant',
        text: assistantTurn.text,
        timestamp: assistantTurn.timestamp
      });

      const finalResult = parseFinal(assistantTurn.text);
      const actionsResult = parseActions(assistantTurn.text);

      if (finalResult.ok && actionsResult.ok) {
        const errorMessage = renderProtocolError('You emitted both final and action protocol blocks. You must choose exactly one per turn.');
        await input.transport.sendMessage(errorMessage);
        await appendJsonl(runDir, 'transcript.jsonl', {
          role: 'user',
          text: errorMessage,
          timestamp: new Date().toISOString()
        });
        continue;
      }

      if (finalResult.ok) {
        await writeTextFile(runDir, 'final.json', JSON.stringify(finalResult.block, null, 2));
        await writeTextFile(runDir, 'final.md', finalResult.block.summary);
        return { runId, runDir, final: finalResult.block };
      }

      if (actionsResult.ok) {
        const results = await executeActions({
          actions: actionsResult.block.actions,
          projectRoot,
          runId,
          runDir,
          turn,
          yes: input.yes
        });
        const renderedResults = renderToolResults(results);
        await input.transport.sendMessage(renderedResults);
        await appendJsonl(runDir, 'transcript.jsonl', {
          role: 'user',
          text: renderedResults,
          timestamp: new Date().toISOString()
        });
        continue;
      }

      let protocolError = 'You did not include a valid conduit-call or conduit-final block. Please respond with exactly one of those blocks.';
      if (!actionsResult.ok && actionsResult.kind === 'malformed') {
        protocolError = `The ACTIONS_JSON block was malformed: ${actionsResult.error}`;
      } else if (!finalResult.ok && finalResult.kind === 'malformed') {
        protocolError = `The FINAL_JSON block was malformed: ${finalResult.error}`;
      } else if (!actionsResult.ok && actionsResult.kind === 'multiple') {
        protocolError = `You emitted multiple ACTIONS_JSON blocks. You must emit exactly one.`;
      } else if (!finalResult.ok && finalResult.kind === 'multiple') {
        protocolError = `You emitted multiple FINAL_JSON blocks. You must emit exactly one.`;
      }

      const errorMessage = renderProtocolError(protocolError);
      await input.transport.sendMessage(errorMessage);
      await appendJsonl(runDir, 'transcript.jsonl', {
        role: 'user',
        text: errorMessage,
        timestamp: new Date().toISOString()
      });
    }

    throw new Error(`Run exceeded maxTurns (${maxTurns}).`);
  } finally {
    await input.transport.close();
  }
}

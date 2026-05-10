import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_EVAL_MODELS,
  GoogleAiStudioProvider,
  runProtocolModelEval,
  type ProtocolEvalModel
} from '../src/evals/protocol-model-eval.js';

const key = process.env.GOOGLE_AI_STUDIO_API_KEY ?? process.env.GEMINI_API_KEY;

if (!key) {
  console.error('Set GOOGLE_AI_STUDIO_API_KEY or GEMINI_API_KEY to run live protocol evals.');
  process.exit(1);
}

const models = parseModels(process.env.CONDUIT_EVAL_MODELS);
const outputPath = process.env.CONDUIT_EVAL_OUTPUT
  ? path.resolve(process.env.CONDUIT_EVAL_OUTPUT)
  : path.resolve('dist/evals/protocol-model-eval.json');

const result = await runProtocolModelEval({
  models,
  provider: new GoogleAiStudioProvider({
    apiKey: key,
    endpoint: process.env.GOOGLE_AI_STUDIO_ENDPOINT
  })
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
console.log(`Passed ${result.summary.passed}/${result.summary.total}; average score ${result.summary.averageScore}`);
for (const item of result.results) {
  const status = item.passed ? 'pass' : 'fail';
  console.log(`${status} ${item.modelId} ${item.scenarioId} score=${item.score}`);
  for (const finding of item.findings) {
    console.log(`  - ${finding}`);
  }
}

function parseModels(value: string | undefined): ProtocolEvalModel[] {
  if (!value?.trim()) {
    return DEFAULT_PROTOCOL_EVAL_MODELS;
  }
  return value.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      provider: 'google-ai-studio' as const
    }));
}

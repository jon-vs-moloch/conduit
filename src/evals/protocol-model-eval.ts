import { extractProtocolBlocks } from '../protocol/extract-protocol-blocks.js';
import { parseActions } from '../protocol/parse-actions.js';

export interface ProtocolEvalScenario {
  id: string;
  title: string;
  prompt: string;
  expectedTools: string[];
  requiredPhrases?: string[];
}

export interface ProtocolEvalModel {
  id: string;
  provider: 'google-ai-studio' | 'fake';
}

export interface ProtocolEvalProvider {
  generate(input: {
    model: ProtocolEvalModel;
    scenario: ProtocolEvalScenario;
    systemPrompt: string;
  }): Promise<string>;
}

export interface ProtocolEvalCaseResult {
  modelId: string;
  scenarioId: string;
  passed: boolean;
  score: number;
  responseText: string;
  extractedBlockCount: number;
  parsedActionCount: number;
  parsedTools: string[];
  findings: string[];
}

export interface ProtocolEvalRunResult {
  generatedAt: string;
  models: string[];
  scenarios: string[];
  results: ProtocolEvalCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    averageScore: number;
  };
}

export const DEFAULT_PROTOCOL_EVAL_MODELS: ProtocolEvalModel[] = [
  { id: 'gemini-2.5-flash-lite', provider: 'google-ai-studio' },
  { id: 'gemini-2.5-flash', provider: 'google-ai-studio' }
];

export const DEFAULT_PROTOCOL_EVAL_SCENARIOS: ProtocolEvalScenario[] = [
  {
    id: 'orient-readme',
    title: 'Orient in a project',
    expectedTools: ['file.list', 'file.read'],
    prompt: [
      'The user asked you to inspect a local project before making changes.',
      'Request the smallest useful Conduit actions to list the project root and read README.md.',
      'Use one Conduit block. For the two local actions, use one compact do array.'
    ].join('\n')
  },
  {
    id: 'status-before-edit',
    title: 'Check worktree before editing',
    expectedTools: ['git.status', 'git.diff'],
    prompt: [
      'The user asked you to continue an in-progress coding task.',
      'Before proposing edits, request Conduit actions to inspect git status and the README diff.',
      'Use compact status and diff actions. Do not use shell, cmd, run, or terminal commands.',
      'Keep the executable request in one clearly separated conduit block.'
    ].join('\n')
  },
  {
    id: 'ask-help',
    title: 'Ask for protocol help',
    expectedTools: ['conduit.help'],
    prompt: [
      'You are not sure which Conduit fields are available.',
      'Ask Conduit for concise protocol examples instead of guessing a larger schema.',
      'Use the compact help shortcut.'
    ].join('\n')
  }
];

export function renderProtocolEvalSystemPrompt(input: {
  sessionId?: string;
  nonce?: string;
} = {}): string {
  const sessionId = input.sessionId ?? 'sess_eval_123';
  const nonce = input.nonce ?? 'call_eval_123';
  return [
    '+------------------------------------------------------------------+',
    '| CONDUIT PROTOCOL :: MODEL EVAL                                   |',
    '| You are being tested for small-model-friendly Conduit output.     |',
    '+------------------------------------------------------------------+',
    '',
    'You may speak to the user in normal prose before or after a request.',
    'Before every Conduit request, write one short sentence explaining what you are asking Conduit to do and why.',
    'When you need local action, emit exactly one fenced `conduit` code block in that turn.',
    'Prefer compact JSON fields: v, session, n, do, path, why.',
    'For multiple actions, use one do array inside one block, never multiple conduit blocks.',
    'Available compact actions are: help, about, list, read, status, diff, write, patch, shell.',
    'For git state, prefer do: ["status", "diff README.md"]. Do not invent run/cmd fields.',
    'Use strict JSON only inside the code block.',
    'Use this session and nonce:',
    '',
    `session: ${sessionId}`,
    `n: ${nonce}`,
    '',
    'Example:',
    '',
    '```conduit',
    JSON.stringify({
      v: '1',
      session: sessionId,
      n: nonce,
      do: ['list .', 'read README.md'],
      why: 'Orient before making changes.'
    }, null, 2),
    '```'
  ].join('\n');
}

export async function runProtocolModelEval(input: {
  models?: ProtocolEvalModel[];
  scenarios?: ProtocolEvalScenario[];
  provider: ProtocolEvalProvider;
  systemPrompt?: string;
}): Promise<ProtocolEvalRunResult> {
  const models = input.models ?? DEFAULT_PROTOCOL_EVAL_MODELS;
  const scenarios = input.scenarios ?? DEFAULT_PROTOCOL_EVAL_SCENARIOS;
  const systemPrompt = input.systemPrompt ?? renderProtocolEvalSystemPrompt();
  const results: ProtocolEvalCaseResult[] = [];

  for (const model of models) {
    for (const scenario of scenarios) {
      const responseText = await input.provider.generate({ model, scenario, systemPrompt });
      results.push(scoreProtocolResponse({
        modelId: model.id,
        scenario,
        responseText
      }));
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  return {
    generatedAt: new Date().toISOString(),
    models: models.map((model) => model.id),
    scenarios: scenarios.map((scenario) => scenario.id),
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      averageScore: results.length === 0 ? 0 : Number((totalScore / results.length).toFixed(3))
    }
  };
}

export function scoreProtocolResponse(input: {
  modelId: string;
  scenario: ProtocolEvalScenario;
  responseText: string;
}): ProtocolEvalCaseResult {
  const findings: string[] = [];
  let score = 0;

  const blocks = extractProtocolBlocks(input.responseText).filter((block) => block.kind === 'conduit');
  if (blocks.length === 1) {
    score += 0.25;
  } else {
    findings.push(`Expected exactly one conduit block, found ${blocks.length}.`);
  }

  const proseOutsideBlock = removeBlockText(input.responseText, blocks.map((block) => block.text)).trim();
  if (proseOutsideBlock.length > 0) {
    score += 0.1;
  } else {
    findings.push('Expected explanatory prose outside the Conduit block.');
  }

  for (const phrase of input.scenario.requiredPhrases ?? []) {
    if (input.responseText.toLowerCase().includes(phrase.toLowerCase())) {
      score += 0.05;
    } else {
      findings.push(`Missing expected explanatory phrase: ${phrase}`);
    }
  }

  const parsed = parseActions(input.responseText);
  const parsedTools = parsed.ok ? parsed.block.actions.map((action) => action.tool) : [];
  if (parsed.ok) {
    score += 0.25;
  } else {
    findings.push(`Parser rejected response: ${parsed.error}`);
  }

  const missingTools = input.scenario.expectedTools.filter((tool) => !parsedTools.includes(tool));
  if (missingTools.length === 0) {
    score += 0.35;
  } else {
    findings.push(`Missing expected tool(s): ${missingTools.join(', ')}`);
  }

  const roundedScore = Number(Math.min(score, 1).toFixed(3));
  return {
    modelId: input.modelId,
    scenarioId: input.scenario.id,
    passed: roundedScore >= 0.85 && findings.length === 0,
    score: roundedScore,
    responseText: input.responseText,
    extractedBlockCount: blocks.length,
    parsedActionCount: parsed.ok ? parsed.block.actions.length : 0,
    parsedTools,
    findings
  };
}

export class GoogleAiStudioProvider implements ProtocolEvalProvider {
  constructor(private readonly input: {
    apiKey: string;
    endpoint?: string;
  }) {}

  async generate(input: {
    model: ProtocolEvalModel;
    scenario: ProtocolEvalScenario;
    systemPrompt: string;
  }): Promise<string> {
    const endpoint = this.input.endpoint ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${endpoint.replace(/\/$/, '')}/models/${input.model.id}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.input.apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: input.scenario.prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google AI Studio request failed for ${input.model.id}: ${response.status} ${body}`);
    }

    const body = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const text = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new Error(`Google AI Studio returned no text for ${input.model.id}.`);
    }
    return text;
  }
}

function removeBlockText(text: string, blockTexts: string[]): string {
  let remaining = text;
  for (const blockText of blockTexts) {
    remaining = remaining.replace(blockText, '');
  }
  return remaining;
}

import { listTools } from '../tools/registry.js';

export interface BuildInitialPromptInput {
  task: string;
  projectRoot: string;
}

export function buildInitialPrompt(input: BuildInitialPromptInput): string {
  const toolList = listTools()
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');

  return [
    'You are Conduit running inside an external browser harness.',
    '',
    'You are still inside ChatGPT. You do not have direct filesystem or shell access.',
    'The harness can perform local actions for you when you request them through the protocol below.',
    '',
    'Task:',
    input.task,
    '',
    'Project root:',
    input.projectRoot,
    '',
    'Allowed tools:',
    toolList,
    '',
    'Protocol:',
    'You may write normal prose for the user.',
    'The harness ignores prose and only reads named protocol code blocks.',
    '',
    'To request one simple action, prefer the compact form:',
    '```conduit',
    '{ "schema": "conduit.request.v1", "read": "README.md", "reason": "Need context.", "risk": "low" }',
    '```',
    '',
    'For multiple actions, emit an actions array:',
    '```conduit',
    '{ "schema": "conduit.request.v1", "actions": [{ "id": "read_file", "read": "README.md" }] }',
    '```',
    '',
    'The harness will execute permitted actions and return TOOL_RESULTS_JSON.',
    '',
    'Do not invent tool results.',
    'Do not ask the user to perform actions that the harness can perform.',
    'Prefer small reversible actions.',
    'When complete, emit exactly one code block with language/title conduit-final:',
    '```conduit-final',
    '{ "status": "complete", "summary": "..." }',
    '```'
  ].join('\n');
}

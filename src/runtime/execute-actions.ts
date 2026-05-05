import readline from 'node:readline';
import type { PolicyDecision } from '../policy/policy-engine.js';
import { evaluateActionPolicy } from '../policy/policy-engine.js';
import type { ToolAction, ToolResult } from '../protocol/schemas.js';
import type { ConduitSession } from '../sessions/session-store.js';
import { appendJsonl } from '../state/logs.js';
import { getTool } from '../tools/registry.js';
import { executeToolAction } from '../tools/types.js';

export interface ExecuteActionsInput {
  actions: ToolAction[];
  projectRoot: string;
  runId: string;
  runDir: string;
  turn: number;
  yes?: boolean;
  policySession?: ConduitSession;
  confirm?: (prompt: string) => Promise<boolean>;
}

export async function executeActions(input: ExecuteActionsInput): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const policySession = input.policySession ?? createEphemeralPolicySession(input.projectRoot);
  const confirm = input.confirm ?? askConfirmation;

  for (const action of input.actions) {
    await appendJsonl(input.runDir, 'actions.jsonl', {
      turn: input.turn,
      ...action,
      timestamp: new Date().toISOString()
    });

    const policyDecision = await evaluateActionPolicy({
      action,
      session: policySession
    });
    await appendJsonl(input.runDir, 'policy-decisions.jsonl', {
      turn: input.turn,
      actionId: action.id,
      tool: action.tool,
      ...policyDecision,
      timestamp: new Date().toISOString()
    });

    const policyResult = await handlePolicyDecision(action, policyDecision, input.yes, confirm);
    if (policyResult) {
      results.push(policyResult);
      continue;
    }

    const tool = getTool(action.tool);
    if (!tool) {
      results.push({
        id: action.id,
        tool: action.tool,
        status: 'denied',
        error: `Unknown tool: ${action.tool}`
      });
      continue;
    }

    results.push(await executeToolAction(action, tool, {
      projectRoot: input.projectRoot,
      runId: input.runId,
      runDir: input.runDir
    }));
  }

  for (const result of results) {
    await appendJsonl(input.runDir, 'tool-results.jsonl', result);
  }

  return results;
}

async function handlePolicyDecision(
  action: ToolAction,
  decision: PolicyDecision,
  yes: boolean | undefined,
  confirm: (prompt: string) => Promise<boolean>
): Promise<ToolResult | null> {
  if (decision.decision === 'allow') {
    return null;
  }

  if (decision.decision === 'requires_confirmation') {
    if (yes) {
      return null;
    }

    const confirmed = await confirm([
      '',
      `[Conduit] The assistant requests to run ${action.tool}.`,
      `Reason: ${action.reason ?? '(none provided)'}`,
      `Policy: ${decision.reason}`,
      `Args: ${JSON.stringify(action.args)}`,
      'Allow this action? (y/N): '
    ].join('\n'));
    if (confirmed) {
      return null;
    }

    return {
      id: action.id,
      tool: action.tool,
      status: 'denied',
      error: 'User denied this action.'
    };
  }

  return {
    id: action.id,
    tool: action.tool,
    status: decision.decision === 'requires_review' ? 'requires_confirmation' : 'denied',
    error: decision.reason
  };
}

function createEphemeralPolicySession(projectRoot: string): ConduitSession {
  return {
    sessionId: 'sess_ephemeral_agent_loop',
    label: 'Ephemeral agent loop',
    createdAt: new Date().toISOString(),
    state: 'active',
    transport: 'api',
    permissionProfile: 'shell-manual',
    allowedRoots: [projectRoot],
    currentNonce: 'call_ephemeral_agent_loop',
    usedNonces: []
  };
}

function askConfirmation(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

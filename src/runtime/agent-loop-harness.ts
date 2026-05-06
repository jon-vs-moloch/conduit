import { createSession, getSession, type ConduitSession } from '../sessions/session-store.js';
import type { PermissionProfileName } from '../sessions/profiles.js';
import { processListenTurn, type ListenSession, type ListenTurnStatus } from './listen-loop.js';

export interface AgentLoopHarnessContext {
  sessionId: string;
  nonce: string;
  projectRoot: string;
  stepIndex: number;
  sentMessages: string[];
  lastSentMessage?: string;
}

export interface AgentLoopTranscriptStep {
  label?: string;
  assistant: string | ((context: AgentLoopHarnessContext) => string);
}

export interface RunAgentLoopTranscriptInput {
  projectRoot: string;
  steps: AgentLoopTranscriptStep[];
  label?: string;
  permissionProfile?: PermissionProfileName;
}

export interface AgentLoopTranscriptTurn {
  label?: string;
  assistantText: string;
  status: ListenTurnStatus;
  sentMessage?: string;
  runId?: string;
}

export interface AgentLoopTranscriptResult {
  session: ConduitSession;
  finalSession: ConduitSession;
  listenSession: ListenSession | null;
  turns: AgentLoopTranscriptTurn[];
  sentMessages: string[];
}

export async function runAgentLoopTranscript(input: RunAgentLoopTranscriptInput): Promise<AgentLoopTranscriptResult> {
  const session = await createSession({
    label: input.label ?? 'Agent loop transcript',
    permissionProfile: input.permissionProfile ?? 'read-only',
    allowedRoots: [input.projectRoot],
    transport: 'extension'
  });
  const transport = new TranscriptHarnessTransport();
  const turns: AgentLoopTranscriptTurn[] = [];
  let listenSession: ListenSession | null = null;
  let currentSession = session;

  for (const [index, step] of input.steps.entries()) {
    const assistantText = typeof step.assistant === 'function'
      ? step.assistant({
        sessionId: currentSession.sessionId,
        nonce: currentSession.currentNonce,
        projectRoot: input.projectRoot,
        stepIndex: index,
        sentMessages: [...transport.sentMessages],
        lastSentMessage: transport.sentMessages.at(-1)
      })
      : step.assistant;
    const beforeSendCount = transport.sentMessages.length;
    const result = await processListenTurn({
      assistantTurn: {
        text: assistantText,
        timestamp: new Date(index).toISOString()
      },
      projectRoot: input.projectRoot,
      transport,
      session: listenSession,
      requireTrustedSession: true
    });

    listenSession = result.session;
    currentSession = await getRequiredSession(currentSession.sessionId);
    turns.push({
      label: step.label,
      assistantText,
      status: result.status,
      sentMessage: transport.sentMessages[beforeSendCount],
      runId: listenSession?.runId
    });
  }

  return {
    session,
    finalSession: currentSession,
    listenSession,
    turns,
    sentMessages: [...transport.sentMessages]
  };
}

export function conduitBlock(value: unknown): string {
  return [
    '```conduit',
    JSON.stringify(value, null, 2),
    '```'
  ].join('\n');
}

export function conduitFinalBlock(value: unknown): string {
  return [
    '```conduit-final',
    JSON.stringify(value, null, 2),
    '```'
  ].join('\n');
}

class TranscriptHarnessTransport {
  readonly sentMessages: string[] = [];

  async sendMessage(message: string): Promise<void> {
    this.sentMessages.push(message);
  }
}

async function getRequiredSession(sessionId: string): Promise<ConduitSession> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Transcript session disappeared: ${sessionId}`);
  }
  return session;
}

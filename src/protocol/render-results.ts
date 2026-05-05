import { CONDUIT_RESULTS_END, CONDUIT_RESULTS_START, TOOL_RESULTS_END, TOOL_RESULTS_START } from './delimiters.js';
import type { ToolResult } from './schemas.js';

const DEFAULT_MAX_RENDERED_CHARS = 30_000;
const MIN_CONTENT_CHARS = 1_000;

export interface RenderToolResultsOptions {
  maxRenderedChars?: number;
}

export function renderToolResults(results: ToolResult[], options: RenderToolResultsOptions = {}): string {
  const maxRenderedChars = options.maxRenderedChars ?? DEFAULT_MAX_RENDERED_CHARS;
  const fullMessage = renderToolResultsMessage(results);
  if (fullMessage.length <= maxRenderedChars) {
    return fullMessage;
  }

  return renderToolResultsMessage(compactResultsForTransport(results, maxRenderedChars));
}

export interface ConduitResultEnvelope {
  type: 'conduit.results.v1';
  runId: string;
  sessionId?: string;
  nextNonce?: string;
  results: ToolResult[];
  status: 'ok' | 'partial' | 'denied' | 'error';
}

export function renderConduitResults(envelope: ConduitResultEnvelope): string {
  return [
    'Conduit results:',
    '',
    CONDUIT_RESULTS_START,
    JSON.stringify(envelope, null, 2),
    CONDUIT_RESULTS_END
  ].join('\n');
}

function renderToolResultsMessage(results: ToolResult[]): string {
  return [
    'Tool results from the harness:',
    '',
    TOOL_RESULTS_START,
    JSON.stringify({ results }, null, 2),
    TOOL_RESULTS_END,
    '',
    'Continue the task. Request more actions with one conduit-call block if needed, or emit one conduit-final block if complete.'
  ].join('\n');
}

export function renderProtocolError(message: string): string {
  return [
    'PROTOCOL ERROR:',
    message,
    '',
    'Please fix this error and emit exactly one valid conduit-call or conduit-final block.'
  ].join('\n');
}

function compactResultsForTransport(results: ToolResult[], maxRenderedChars: number): ToolResult[] {
  const stringContentResults = results.filter((result) => typeof result.content === 'string');
  if (stringContentResults.length === 0) {
    return results;
  }

  const overhead = renderToolResultsMessage(results.map((result) => {
    if (typeof result.content !== 'string') return result;
    return {
      ...result,
      content: '',
      metadata: {
        ...result.metadata,
        conduitTransportTruncated: true,
        originalContentChars: result.content.length
      }
    };
  })).length;
  const availableContentChars = Math.max(
    MIN_CONTENT_CHARS,
    maxRenderedChars - overhead - (stringContentResults.length * 300)
  );
  const perStringBudget = Math.max(
    MIN_CONTENT_CHARS,
    Math.floor(availableContentChars / stringContentResults.length)
  );

  return results.map((result) => {
    if (typeof result.content !== 'string' || result.content.length <= perStringBudget) {
      return result;
    }

    return {
      ...result,
      content: [
        result.content.slice(0, perStringBudget),
        '',
        `[Conduit transport truncated this tool result from ${result.content.length} chars. Request a narrower file.read range or higher maxChars if more context is needed.]`
      ].join('\n'),
      metadata: {
        ...result.metadata,
        conduitTransportTruncated: true,
        originalContentChars: result.content.length,
        deliveredContentChars: perStringBudget
      }
    };
  });
}

import { z } from 'zod';
import { ActionRequestBlockSchema, type ActionRequestBlock } from './schemas.js';
import { type ParseResult } from './block-parser.js';

const DEFAULT_MAX_CLIPBOARD_ENVELOPE_BYTES = 1_000_000;
const FENCED_ENVELOPE_PATTERN = /^```[ \t]*(conduit|conduit-json)(?:[ \t]+json)?[^\n]*\n([\s\S]*)\n```$/;

export interface ParseClipboardEnvelopeOptions {
  maxBytes?: number;
}

/**
 * Compliance-mode clipboard parser.
 *
 * This parser accepts only a standalone Conduit envelope after trimming
 * leading/trailing whitespace. It must remain separate from parseActions,
 * which is an elevated embedded-block parser for authenticated agent turns.
 */
const ClipboardRequestSchema = ActionRequestBlockSchema.superRefine((request, ctx) => {
  if (request.schema !== 'conduit.request.v1') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clipboard requests require schema: conduit.request.v1',
      path: ['schema']
    });
  }

  if (!request.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clipboard requests require source metadata.',
      path: ['source']
    });
  }

  if (!request.permissions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clipboard requests require declared permissions.',
      path: ['permissions']
    });
  }
});

export function parseClipboardEnvelope(
  text: string,
  options: ParseClipboardEnvelopeOptions = {}
): ParseResult<ActionRequestBlock> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CLIPBOARD_ENVELOPE_BYTES;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return {
      ok: false,
      kind: 'malformed',
      error: `Clipboard envelope exceeds maximum size: ${maxBytes} bytes.`
    };
  }

  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, kind: 'none' };
  }

  if (countFencedEnvelopeStarts(trimmed) > 1) {
    return {
      ok: false,
      kind: 'multiple',
      error: 'Clipboard contains multiple Conduit envelopes.'
    };
  }

  const jsonText = extractExactEnvelopeJson(trimmed);
  if (jsonText === null) {
    return { ok: false, kind: 'none' };
  }

  const duplicateKey = findDuplicateJsonObjectKey(jsonText);
  if (duplicateKey) {
    return {
      ok: false,
      kind: 'malformed',
      error: `Duplicate JSON object key: ${duplicateKey}`
    };
  }

  try {
    const parsed = JSON.parse(jsonText);
    return { ok: true, block: ClipboardRequestSchema.parse(parsed) };
  } catch (error) {
    return {
      ok: false,
      kind: 'malformed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function countFencedEnvelopeStarts(text: string): number {
  return [...text.matchAll(/(?:^|\n)```[ \t]*(?:conduit|conduit-json)(?:[ \t]|\n)/g)].length;
}

function extractExactEnvelopeJson(trimmed: string): string | null {
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(FENCED_ENVELOPE_PATTERN);
  if (fencedMatch) {
    return fencedMatch[2]?.trim() ?? null;
  }

  return null;
}

function findDuplicateJsonObjectKey(jsonText: string): string | null {
  const stack: Array<Set<string>> = [];
  let index = 0;

  while (index < jsonText.length) {
    const char = jsonText[index];

    if (isWhitespace(char) || char === ',' || char === ':') {
      index += 1;
      continue;
    }

    if (char === '{') {
      stack.push(new Set());
      index += 1;
      continue;
    }

    if (char === '}') {
      stack.pop();
      index += 1;
      continue;
    }

    if (char === '[' || char === ']') {
      index += 1;
      continue;
    }

    if (char === '"') {
      const parsed = readJsonString(jsonText, index);
      if (!parsed) {
        return null;
      }

      const nextIndex = skipWhitespace(jsonText, parsed.endIndex + 1);
      const isObjectKey = stack.length > 0 && jsonText[nextIndex] === ':';
      if (isObjectKey) {
        const currentObjectKeys = stack[stack.length - 1];
        if (currentObjectKeys.has(parsed.value)) {
          return parsed.value;
        }
        currentObjectKeys.add(parsed.value);
      }
      index = parsed.endIndex + 1;
      continue;
    }

    index += 1;
  }

  return null;
}

function readJsonString(text: string, startIndex: number): { value: string; endIndex: number } | null {
  let value = '';
  let index = startIndex + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      return { value, endIndex: index };
    }
    if (char === '\\') {
      const next = text[index + 1];
      if (next === undefined) {
        return null;
      }
      value += `\\${next}`;
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
  return null;
}

function skipWhitespace(text: string, index: number): number {
  let current = index;
  while (current < text.length && isWhitespace(text[current])) {
    current += 1;
  }
  return current;
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

import { z } from 'zod';
import { extractProtocolBlocks } from './extract-protocol-blocks.js';

export type ParseResult<T> =
  | { ok: true; block: T }
  | { ok: false; kind: 'none' | 'multiple' | 'malformed'; error?: string };

export function parseDelimitedJsonBlock<T>(
  text: string,
  start: string,
  end: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): ParseResult<T> {
  const matches = [...text.matchAll(new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, 'g'))];

  if (matches.length === 0) {
    return { ok: false, kind: 'none' };
  }

  if (matches.length > 1) {
    return { ok: false, kind: 'multiple', error: `Expected one block, found ${matches.length}` };
  }

  try {
    const parsed = JSON.parse(matches[0]?.[1]?.trim() ?? '');
    const validated = schema.parse(parsed);
    return { ok: true, block: validated };
  } catch (error) {
    return {
      ok: false,
      kind: 'malformed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function parseNamedJsonCodeBlock<T>(
  text: string,
  blockName: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): ParseResult<T> {
  const matches = extractProtocolBlocks(text).filter((block) => block.kind === blockName);

  if (matches.length === 0) {
    return { ok: false, kind: 'none' };
  }

  if (matches.length > 1) {
    return { ok: false, kind: 'multiple', error: `Expected one ${blockName} block, found ${matches.length}` };
  }

  try {
    const parsed = JSON.parse(matches[0]?.jsonText ?? '');
    const validated = schema.parse(parsed);
    return { ok: true, block: validated };
  } catch (error) {
    return {
      ok: false,
      kind: 'malformed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { ACTIONS_END, ACTIONS_START } from './delimiters.js';
import { ActionRequestBlockSchema, type ActionRequestBlock } from './schemas.js';
import { parseDelimitedJsonBlock, parseNamedJsonCodeBlock, type ParseResult } from './block-parser.js';

/**
 * Elevated agent-turn parser.
 *
 * This intentionally scans larger assistant messages for embedded protocol
 * blocks. Do not use it for default clipboard/daemon execution; Compliance
 * Mode clipboard execution must use parseClipboardEnvelope instead. This
 * parser belongs behind an authenticated agent transport or explicit unsafe
 * embedded-block setting.
 */
export function parseActions(text: string): ParseResult<ActionRequestBlock> {
  const conduitRequestBlock = parseNamedJsonCodeBlock(text, 'conduit', ActionRequestBlockSchema);
  const conduitBlock = parseNamedJsonCodeBlock(text, 'conduit-call', ActionRequestBlockSchema);
  const veyrBlock = parseNamedJsonCodeBlock(text, 'veyr-call', ActionRequestBlockSchema);
  const legacyBlock = parseDelimitedJsonBlock(text, ACTIONS_START, ACTIONS_END, ActionRequestBlockSchema);
  const presentBlocks = [conduitRequestBlock, conduitBlock, veyrBlock, legacyBlock].filter((block) => block.ok || block.kind !== 'none');

  if (presentBlocks.length > 1) {
    return { ok: false, kind: 'multiple', error: 'Found multiple action protocol blocks.' };
  }

  if (conduitRequestBlock.ok || conduitRequestBlock.kind !== 'none') {
    return conduitRequestBlock;
  }

  if (conduitBlock.ok || conduitBlock.kind !== 'none') {
    return conduitBlock;
  }

  if (veyrBlock.ok || veyrBlock.kind !== 'none') {
    return veyrBlock;
  }

  return legacyBlock;
}

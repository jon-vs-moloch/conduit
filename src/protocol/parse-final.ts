import { FINAL_END, FINAL_START } from './delimiters.js';
import { FinalBlockSchema, type FinalBlock } from './schemas.js';
import { parseDelimitedJsonBlock, parseNamedJsonCodeBlock, type ParseResult } from './block-parser.js';

export function parseFinal(text: string): ParseResult<FinalBlock> {
  const conduitBlock = parseNamedJsonCodeBlock(text, 'conduit-final', FinalBlockSchema);
  const veyrBlock = parseNamedJsonCodeBlock(text, 'veyr-final', FinalBlockSchema);
  const legacyBlock = parseDelimitedJsonBlock(text, FINAL_START, FINAL_END, FinalBlockSchema);
  const presentBlocks = [conduitBlock, veyrBlock, legacyBlock].filter((block) => block.ok || block.kind !== 'none');

  if (presentBlocks.length > 1) {
    return { ok: false, kind: 'multiple', error: 'Found multiple final protocol blocks.' };
  }

  if (conduitBlock.ok || conduitBlock.kind !== 'none') {
    return conduitBlock;
  }

  if (veyrBlock.ok || veyrBlock.kind !== 'none') {
    return veyrBlock;
  }

  return legacyBlock;
}

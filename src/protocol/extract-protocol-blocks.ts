export type ProtocolBlockKind =
  | 'conduit'
  | 'conduit-call'
  | 'conduit-final'
  | 'veyr-call'
  | 'veyr-final'
  | 'legacy-actions'
  | 'legacy-final';

export interface ExtractedProtocolBlock {
  kind: ProtocolBlockKind;
  text: string;
  jsonText: string;
}

const NAMED_BLOCK_PATTERN = /(?:^|\n)(```[ \t]*(?:json[ \t]+)?(conduit-call|conduit-final|veyr-call|veyr-final|conduit)(?:[ \t]+json)?[^\n]*\n([\s\S]*?)\n```)/g;

export function extractProtocolBlocks(text: string): ExtractedProtocolBlock[] {
  return [
    ...extractNamedCodeBlocks(text),
    ...extractRenderedNamedBlocks(text),
    ...extractLegacyBlocks(text, 'legacy-actions', '<<<ACTIONS_JSON', 'ACTIONS_JSON>>>'),
    ...extractLegacyBlocks(text, 'legacy-final', '<<<FINAL_JSON', 'FINAL_JSON>>>')
  ];
}

function extractNamedCodeBlocks(text: string): ExtractedProtocolBlock[] {
  const blocks: ExtractedProtocolBlock[] = [];
  for (const match of text.matchAll(NAMED_BLOCK_PATTERN)) {
    const fullBlock = match[1];
    const kind = match[2];
    const jsonText = match[3];
    if (!fullBlock || !isNamedProtocolKind(kind) || jsonText === undefined) {
      continue;
    }

    blocks.push({
      kind,
      text: fullBlock,
      jsonText: jsonText.trim()
    });
  }

  return blocks;
}

function extractLegacyBlocks(
  text: string,
  kind: ProtocolBlockKind,
  start: string,
  end: string
): ExtractedProtocolBlock[] {
  const blocks: ExtractedProtocolBlock[] = [];
  const pattern = new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, 'g');

  for (const match of text.matchAll(pattern)) {
    const fullBlock = match[0];
    const jsonText = match[1];
    if (!fullBlock || jsonText === undefined) {
      continue;
    }

    blocks.push({
      kind,
      text: fullBlock,
      jsonText: jsonText.trim()
    });
  }

  return blocks;
}

function extractRenderedNamedBlocks(text: string): ExtractedProtocolBlock[] {
  const blocks: ExtractedProtocolBlock[] = [];
  for (const kind of ['conduit-call', 'conduit-final', 'veyr-call', 'veyr-final'] as const) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const labelIndex = text.indexOf(kind, searchFrom);
      if (labelIndex === -1) break;
      if (isInsideFencedBlock(text, labelIndex)) {
        searchFrom = labelIndex + kind.length;
        continue;
      }

      const jsonStart = text.indexOf('{', labelIndex + kind.length);
      if (jsonStart === -1) break;

      const jsonEnd = findJsonObjectEnd(text, jsonStart);
      if (jsonEnd === -1) {
        searchFrom = jsonStart + 1;
        continue;
      }

      const jsonText = text.slice(jsonStart, jsonEnd + 1).trim();
      if (isValidJson(jsonText)) {
        blocks.push({
          kind,
          text: [
            `\`\`\`${kind}`,
            jsonText,
            '```'
          ].join('\n'),
          jsonText
        });
      }

      searchFrom = jsonEnd + 1;
    }
  }

  return blocks;
}

function isNamedProtocolKind(kind: unknown): kind is ProtocolBlockKind {
  return kind === 'conduit-call'
    || kind === 'conduit'
    || kind === 'conduit-final'
    || kind === 'veyr-call'
    || kind === 'veyr-final';
}

function findJsonObjectEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isValidJson(jsonText: string): boolean {
  try {
    JSON.parse(jsonText);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideFencedBlock(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fenceCount = before.match(/```/g)?.length ?? 0;
  return fenceCount % 2 === 1;
}

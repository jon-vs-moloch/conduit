const CARD_WIDTH = 68;

export interface RenderProtocolCardInput {
  title: string;
  subtitle: string;
  details?: string[];
}

export function renderProtocolCard(input: RenderProtocolCardInput): string {
  const lines = [
    `CONDUIT PROTOCOL :: ${input.title}`,
    input.subtitle,
    ...(input.details ?? [])
  ];

  return [
    `+${'-'.repeat(CARD_WIDTH - 2)}+`,
    ...lines.map((line) => `| ${padRight(line, CARD_WIDTH - 4)} |`),
    `+${'-'.repeat(CARD_WIDTH - 2)}+`
  ].join('\n');
}

function padRight(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

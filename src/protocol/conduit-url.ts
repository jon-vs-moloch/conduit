import { Buffer } from 'node:buffer';

export interface ParsedConduitUrl {
  text: string;
  command: string;
}

const MAX_CONDUIT_URL_PAYLOAD_BYTES = 1_000_000;

export function createConduitUrl(text: string, command = 'run'): string {
  const payload = Buffer.from(text, 'utf8')
    .toString('base64url');
  return `conduit://${encodeURIComponent(command)}?payload=${payload}`;
}

export function parseConduitUrl(rawUrl: string): ParsedConduitUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Conduit URL.');
  }

  if (url.protocol !== 'conduit:') {
    throw new Error('URL must use the conduit:// scheme.');
  }

  const command = decodeURIComponent(url.hostname || url.pathname.replace(/^\/+/, '') || 'run');
  if (command !== 'run' && command !== 'request') {
    throw new Error(`Unsupported Conduit URL command: ${command}`);
  }

  const payload = url.searchParams.get('payload') ?? url.searchParams.get('p');
  const text = payload ? decodeBase64UrlPayload(payload) : url.searchParams.get('text');
  if (!text) {
    throw new Error('Conduit URL is missing a payload.');
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_CONDUIT_URL_PAYLOAD_BYTES) {
    throw new Error(`Conduit URL payload exceeds maximum size: ${MAX_CONDUIT_URL_PAYLOAD_BYTES} bytes.`);
  }

  return { command, text };
}

function decodeBase64UrlPayload(payload: string): string {
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    throw new Error('Conduit URL payload is not valid base64url.');
  }
}

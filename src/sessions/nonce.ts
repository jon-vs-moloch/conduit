import { randomBytes } from 'node:crypto';

export function createNonce(): string {
  return `call_${randomBytes(16).toString('base64url')}`;
}

export function createSessionId(): string {
  return `sess_${randomBytes(16).toString('base64url')}`;
}

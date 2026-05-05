import { randomBytes } from 'node:crypto';

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

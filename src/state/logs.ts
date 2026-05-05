import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureRunDir(runDir: string): Promise<void> {
  await mkdir(runDir, { recursive: true });
}

export async function writeTextFile(runDir: string, filename: string, content: string): Promise<void> {
  await writeFile(path.join(runDir, filename), content, 'utf8');
}

export async function appendJsonl(runDir: string, filename: string, value: unknown): Promise<void> {
  await appendFile(path.join(runDir, filename), `${JSON.stringify(value)}\n`, 'utf8');
}

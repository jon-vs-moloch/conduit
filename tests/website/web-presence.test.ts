import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const websiteRoot = path.resolve('website');
const pages = ['index.html', 'download.html', 'about.html', 'api.html'];

describe('web presence', () => {
  it('ships the required public pages', async () => {
    for (const page of pages) {
      const html = await readWebsiteFile(page);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Conduit');
      expect(html).toContain('assets/site.css');
      expect(html).not.toMatch(/lorem|placeholder|TODO/i);
    }
  });

  it('keeps navigation links valid across the static site', async () => {
    const knownFiles = new Set([
      ...pages,
      'assets/site.css',
      'assets/conduit-preview.svg'
    ]);

    for (const page of pages) {
      const html = await readWebsiteFile(page);
      const links = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
      for (const link of links) {
        if (link.startsWith('http') || link.startsWith('#')) continue;
        expect(knownFiles.has(link), `${page} references missing asset or page ${link}`).toBe(true);
      }
    }
  });

  it('documents the exact-envelope security contract on the public API page', async () => {
    const api = await readWebsiteFile('api.html');
    expect(api).toContain('schema');
    expect(api).toContain('source');
    expect(api).toContain('permissions');
    expect(api).toContain('sessionId');
    expect(api).toContain('nonce');
    expect(api).toContain('rejects prose wrappers');
    expect(api).toContain('Duplicate JSON keys');
  });
});

async function readWebsiteFile(file: string): Promise<string> {
  return readFile(path.join(websiteRoot, file), 'utf8');
}

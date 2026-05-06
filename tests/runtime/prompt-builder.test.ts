import { describe, expect, it } from 'vitest';
import { buildInitialPrompt } from '../../src/runtime/prompt-builder.js';

describe('buildInitialPrompt', () => {
  it('renders the browser harness prompt as a Conduit protocol message', () => {
    const prompt = buildInitialPrompt({
      task: 'Read README.md',
      projectRoot: '/tmp/project'
    });

    expect(prompt).toContain('CONDUIT PROTOCOL :: BROWSER HARNESS');
    expect(prompt).toContain('not a normal user prompt');
    expect(prompt).toContain('Ask Conduit for local actions');
    expect(prompt).toContain('```conduit');
    expect(prompt).toContain('"schema": "conduit.request.v1"');
    expect(prompt).toContain('```conduit-final');
    expect(prompt).toContain('Do not invent local tool results');
  });
});

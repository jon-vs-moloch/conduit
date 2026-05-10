import { describe, expect, it } from 'vitest';
import {
  renderProtocolEvalSystemPrompt,
  runProtocolModelEval,
  scoreProtocolResponse,
  type ProtocolEvalProvider
} from '../../src/evals/protocol-model-eval.js';

describe('protocol model eval harness', () => {
  it('scores compact Conduit responses that parse into expected tools', () => {
    const result = scoreProtocolResponse({
      modelId: 'fake-small',
      scenario: {
        id: 'orient',
        title: 'Orient',
        prompt: 'List root and read README.',
        expectedTools: ['file.list', 'file.read'],
        requiredPhrases: ['first']
      },
      responseText: [
        'I will first inspect the project root and README.',
        '',
        '```conduit',
        JSON.stringify({
          v: '1',
          session: 'sess_eval_123',
          n: 'call_eval_123',
          do: ['list .', 'read README.md'],
          why: 'Orient before making changes.'
        }, null, 2),
        '```'
      ].join('\n')
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.parsedTools).toEqual(['file.list', 'file.read']);
    expect(result.findings).toEqual([]);
  });

  it('flags responses that use prose but fail to emit a valid protocol block', () => {
    const result = scoreProtocolResponse({
      modelId: 'fake-small',
      scenario: {
        id: 'help',
        title: 'Help',
        prompt: 'Ask for help.',
        expectedTools: ['conduit.help'],
        requiredPhrases: ['help']
      },
      responseText: 'I need help, so please run conduit help for me.'
    });

    expect(result.passed).toBe(false);
    expect(result.extractedBlockCount).toBe(0);
    expect(result.parsedActionCount).toBe(0);
    expect(result.findings).toEqual(expect.arrayContaining([
      'Expected exactly one conduit block, found 0.',
      'Missing expected tool(s): conduit.help'
    ]));
  });

  it('runs scenarios through an injected provider without network access', async () => {
    const provider: ProtocolEvalProvider = {
      async generate({ scenario }) {
        return [
          'I will use the compact request format.',
          '',
          '```conduit',
          JSON.stringify({
            v: '1',
            session: 'sess_eval_123',
            n: 'call_eval_123',
            do: scenario.id === 'status-before-edit' ? ['status', 'diff README.md'] : ['list .', 'read README.md'],
            why: 'Need the requested local context.'
          }, null, 2),
          '```'
        ].join('\n');
      }
    };

    const result = await runProtocolModelEval({
      models: [{ id: 'fake-small', provider: 'fake' }],
      scenarios: [
        {
          id: 'status-before-edit',
          title: 'Status',
          prompt: 'Check status and diff.',
          expectedTools: ['git.status', 'git.diff'],
          requiredPhrases: ['compact']
        }
      ],
      provider,
      systemPrompt: renderProtocolEvalSystemPrompt()
    });

    expect(result.summary).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      averageScore: 1
    });
    expect(result.results[0]?.parsedTools).toEqual(['git.status', 'git.diff']);
  });

  it('renders a minimal reusable system prompt with fixed session and nonce', () => {
    const prompt = renderProtocolEvalSystemPrompt({
      sessionId: 'sess_test',
      nonce: 'call_test'
    });

    expect(prompt).toContain('CONDUIT PROTOCOL :: MODEL EVAL');
    expect(prompt).toContain('session: sess_test');
    expect(prompt).toContain('n: call_test');
    expect(prompt).toContain('Prefer compact JSON fields');
  });
});

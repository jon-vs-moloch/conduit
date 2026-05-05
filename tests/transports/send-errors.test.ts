import { describe, expect, it } from 'vitest';
import { isRetryableSendError } from '../../src/transports/send-errors.js';

describe('isRetryableSendError', () => {
  it('classifies temporary browser send failures as retryable', () => {
    expect(isRetryableSendError('Send button unavailable.')).toBe(true);
    expect(isRetryableSendError('Timed out waiting for send button')).toBe(true);
    expect(isRetryableSendError('Attachment still uploading')).toBe(true);
  });

  it('does not classify protocol or tool failures as retryable send failures', () => {
    expect(isRetryableSendError('The ACTIONS_JSON block was malformed')).toBe(false);
    expect(isRetryableSendError('Unknown tool: file.destroy')).toBe(false);
  });
});

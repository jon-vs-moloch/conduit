const RETRYABLE_SEND_ERROR_FRAGMENTS = [
  'Send button unavailable',
  'Composer not ready',
  'Attachment still uploading',
  'Timed out waiting for send button',
  'Timed out waiting for composer stabilization',
  'Timed out waiting for committed message',
  'Timed out waiting for composer to clear',
  'Composer text insertion failed'
];

export function isRetryableSendError(error: string): boolean {
  return RETRYABLE_SEND_ERROR_FRAGMENTS.some((fragment) => error.includes(fragment));
}

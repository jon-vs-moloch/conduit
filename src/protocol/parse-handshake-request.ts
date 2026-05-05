import { z } from 'zod';
import { parseNamedJsonCodeBlock, type ParseResult } from './block-parser.js';

export const HandshakeRequestSchema = z.object({
  schema: z.literal('conduit.handshake.request.v1'),
  reason: z.string().min(1).optional(),
  requestedProfile: z.enum(['read-only', 'edit-with-confirmation', 'shell-manual']).optional(),
  requestedRoot: z.string().optional(),
  docsRead: z.boolean().optional()
});

export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;

export function parseHandshakeRequest(text: string): ParseResult<HandshakeRequest> {
  return parseNamedJsonCodeBlock(text, 'conduit-handshake-request', HandshakeRequestSchema);
}

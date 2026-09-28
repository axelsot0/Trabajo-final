import { computeMetaSignatureHeader } from '../../src/adapters/meta/signature.ts';

export const TEST_META_APP_SECRET = 'test-meta-app-secret';
export const TEST_META_VERIFY_TOKEN = 'test-meta-verify-token';

export interface MessagingItemInput {
  senderId: string;
  recipientId: string;
  timestamp: number;
  mid: string;
  text?: string;
  isEcho?: boolean;
  attachments?: { type: string; url?: string }[];
  isUnsupported?: boolean;
  isDeleted?: boolean;
}

export function messagingItem(input: MessagingItemInput): Record<string, unknown> {
  const message: Record<string, unknown> = { mid: input.mid };
  if (input.text !== undefined) message['text'] = input.text;
  if (input.isEcho) message['is_echo'] = true;
  if (input.isUnsupported) message['is_unsupported'] = true;
  if (input.isDeleted) message['is_deleted'] = true;
  if (input.attachments) {
    message['attachments'] = input.attachments.map((a) => ({
      type: a.type,
      payload: a.url === undefined ? {} : { url: a.url },
    }));
  }
  return {
    sender: { id: input.senderId },
    recipient: { id: input.recipientId },
    timestamp: input.timestamp,
    message,
  };
}

export function instagramPayload(
  entryId: string,
  items: Record<string, unknown>[],
  time = 1_790_560_000_000,
): Record<string, unknown> {
  return { object: 'instagram', entry: [{ id: entryId, time, messaging: items }] };
}

/** Construye una petición firmada tal como la enviaría Meta. */
export async function signedMetaRequest(
  body: unknown,
  options: { secret?: string; tamperSignature?: boolean; rawBody?: string } = {},
): Promise<Request> {
  const raw = options.rawBody ?? JSON.stringify(body);
  const bytes = new TextEncoder().encode(raw);
  let signature = await computeMetaSignatureHeader(options.secret ?? TEST_META_APP_SECRET, bytes);
  if (options.tamperSignature) {
    signature = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
  }
  return new Request('https://example.com/webhooks/meta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });
}

import { z } from 'zod';

/**
 * Esquema tolerante del webhook `instagram` (campo `messages`). Meta añade campos
 * con frecuencia; solo se exige lo imprescindible y el resto se conserva sin uso.
 * Referencia: docs de Webhooks de Instagram Platform (validar en meta-validation.md).
 */
const idRef = z.object({ id: z.string().min(1) }).loose();

const attachment = z
  .object({
    type: z.string().min(1),
    payload: z.object({ url: z.string().optional() }).loose().optional(),
  })
  .loose();

const message = z
  .object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
    is_unsupported: z.boolean().optional(),
    attachments: z.array(attachment).optional(),
    reply_to: z.object({ mid: z.string().optional() }).loose().optional(),
  })
  .loose();

const postback = z
  .object({
    mid: z.string().min(1),
    title: z.string().optional(),
    payload: z.string().optional(),
  })
  .loose();

const messagingItem = z
  .object({
    sender: idRef,
    recipient: idRef,
    timestamp: z.number().int().nonnegative(),
    message: message.optional(),
    postback: postback.optional(),
    reaction: z.object({}).loose().optional(),
    read: z.object({}).loose().optional(),
  })
  .loose();

const entry = z
  .object({
    id: z.string().min(1),
    time: z.number().int().nonnegative(),
    messaging: z.array(messagingItem).optional(),
  })
  .loose();

export const metaWebhookPayloadSchema = z
  .object({
    object: z.literal('instagram'),
    entry: z.array(entry),
  })
  .loose();

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

export interface MetaAttachmentRef {
  type: string;
  url: string | null;
}

/** Evento normalizado y mínimo que se persiste en `webhook_events.payload_minimal`. */
export type MetaInboundEvent =
  | {
      kind: 'message';
      igAccountUserId: string;
      senderScopedId: string;
      mid: string;
      timestampMs: number;
      text: string | null;
      attachments: MetaAttachmentRef[];
      isUnsupported: boolean;
      isDeleted: boolean;
      replyToMid: string | null;
    }
  | {
      kind: 'echo';
      igAccountUserId: string;
      recipientScopedId: string;
      mid: string;
      timestampMs: number;
      text: string | null;
    }
  | {
      kind: 'postback';
      igAccountUserId: string;
      senderScopedId: string;
      mid: string;
      timestampMs: number;
      payload: string | null;
      title: string | null;
    }
  | {
      kind: 'read' | 'reaction' | 'unknown';
      igAccountUserId: string;
      senderScopedId: string;
      timestampMs: number;
    };

export const metaInboundEventSchema: z.ZodType<MetaInboundEvent> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    igAccountUserId: z.string(),
    senderScopedId: z.string(),
    mid: z.string(),
    timestampMs: z.number(),
    text: z.string().nullable(),
    attachments: z.array(z.object({ type: z.string(), url: z.string().nullable() })),
    isUnsupported: z.boolean(),
    isDeleted: z.boolean(),
    replyToMid: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('echo'),
    igAccountUserId: z.string(),
    recipientScopedId: z.string(),
    mid: z.string(),
    timestampMs: z.number(),
    text: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('postback'),
    igAccountUserId: z.string(),
    senderScopedId: z.string(),
    mid: z.string(),
    timestampMs: z.number(),
    payload: z.string().nullable(),
    title: z.string().nullable(),
  }),
  z.object({
    kind: z.enum(['read', 'reaction', 'unknown']),
    igAccountUserId: z.string(),
    senderScopedId: z.string(),
    timestampMs: z.number(),
  }),
]);

/** Clave idempotente por evento. Mensajes y postbacks usan el `mid`, que Meta garantiza único. */
export function eventKey(event: MetaInboundEvent): string {
  switch (event.kind) {
    case 'message':
    case 'echo':
    case 'postback':
      return `meta:${event.mid}`;
    case 'read':
    case 'reaction':
    case 'unknown':
      return `meta:${event.kind}:${event.igAccountUserId}:${event.senderScopedId}:${event.timestampMs}`;
  }
}

/** Aplana el payload en eventos normalizados. No inventa contenido: lo desconocido se marca. */
export function normalizeMetaPayload(payload: MetaWebhookPayload): MetaInboundEvent[] {
  const events: MetaInboundEvent[] = [];
  for (const e of payload.entry) {
    for (const item of e.messaging ?? []) {
      const timestampMs = item.timestamp;
      if (item.message) {
        const m = item.message;
        if (m.is_echo === true) {
          events.push({
            kind: 'echo',
            igAccountUserId: item.sender.id,
            recipientScopedId: item.recipient.id,
            mid: m.mid,
            timestampMs,
            text: m.text ?? null,
          });
          continue;
        }
        events.push({
          kind: 'message',
          igAccountUserId: item.recipient.id,
          senderScopedId: item.sender.id,
          mid: m.mid,
          timestampMs,
          text: m.text ?? null,
          attachments: (m.attachments ?? []).map((a) => ({
            type: a.type,
            url: a.payload?.url ?? null,
          })),
          isUnsupported: m.is_unsupported === true,
          isDeleted: m.is_deleted === true,
          replyToMid: m.reply_to?.mid ?? null,
        });
        continue;
      }
      if (item.postback) {
        events.push({
          kind: 'postback',
          igAccountUserId: item.recipient.id,
          senderScopedId: item.sender.id,
          mid: item.postback.mid,
          timestampMs,
          payload: item.postback.payload ?? null,
          title: item.postback.title ?? null,
        });
        continue;
      }
      events.push({
        kind: item.read ? 'read' : item.reaction ? 'reaction' : 'unknown',
        igAccountUserId: item.recipient.id,
        senderScopedId: item.sender.id,
        timestampMs,
      });
    }
  }
  return events;
}

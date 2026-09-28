import { describe, expect, it } from 'vitest';

import {
  eventKey,
  metaWebhookPayloadSchema,
  normalizeMetaPayload,
} from '../../../src/adapters/meta/webhook-schema.ts';
import { instagramPayload, messagingItem } from '../../support/meta-payloads.ts';

describe('normalizeMetaPayload', () => {
  it('separa mensajes, ecos, adjuntos y tipos desconocidos sin inventar contenido', () => {
    const payload = metaWebhookPayloadSchema.parse(
      instagramPayload('17841400000000000', [
        messagingItem({
          senderId: 'cliente-1',
          recipientId: '17841400000000000',
          timestamp: 1_790_560_000_000,
          mid: 'mid.text',
          text: 'Hola',
        }),
        messagingItem({
          senderId: '17841400000000000',
          recipientId: 'cliente-1',
          timestamp: 1_790_560_001_000,
          mid: 'mid.echo',
          text: 'Respuesta propia',
          isEcho: true,
        }),
        messagingItem({
          senderId: 'cliente-1',
          recipientId: '17841400000000000',
          timestamp: 1_790_560_002_000,
          mid: 'mid.img',
          attachments: [{ type: 'image', url: 'https://cdn.example/x.jpg' }],
        }),
        {
          sender: { id: 'cliente-1' },
          recipient: { id: '17841400000000000' },
          timestamp: 1_790_560_003_000,
          read: { mid: 'mid.text' },
        },
        {
          sender: { id: 'cliente-1' },
          recipient: { id: '17841400000000000' },
          timestamp: 1_790_560_004_000,
          something_new: {},
        },
      ]),
    );

    const events = normalizeMetaPayload(payload);
    expect(events.map((e) => e.kind)).toEqual(['message', 'echo', 'message', 'read', 'unknown']);
    expect(events[0]).toMatchObject({
      kind: 'message',
      igAccountUserId: '17841400000000000',
      senderScopedId: 'cliente-1',
      mid: 'mid.text',
      text: 'Hola',
      attachments: [],
    });
    expect(events[1]).toMatchObject({
      kind: 'echo',
      mid: 'mid.echo',
      recipientScopedId: 'cliente-1',
    });
    expect(events[2]).toMatchObject({
      kind: 'message',
      text: null,
      attachments: [{ type: 'image', url: 'https://cdn.example/x.jpg' }],
    });
    expect(events.map(eventKey)).toEqual([
      'meta:mid.text',
      'meta:mid.echo',
      'meta:mid.img',
      'meta:read:17841400000000000:cliente-1:1790560003000',
      'meta:unknown:17841400000000000:cliente-1:1790560004000',
    ]);
  });

  it('rechaza objetos que no son instagram y entradas sin id', () => {
    expect(metaWebhookPayloadSchema.safeParse({ object: 'page', entry: [] }).success).toBe(false);
    expect(
      metaWebhookPayloadSchema.safeParse({ object: 'instagram', entry: [{ time: 1 }] }).success,
    ).toBe(false);
    expect(metaWebhookPayloadSchema.safeParse({ object: 'instagram', entry: [] }).success).toBe(
      true,
    );
  });
});

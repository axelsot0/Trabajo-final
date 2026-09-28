import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageOrigin = 'instagram' | 'telegram' | 'ai' | 'system';
export type DeliveryStatus = 'received' | 'queued' | 'sent' | 'failed' | 'uncertain';

/** Tipos de contenido que reconoce el MVP; cualquier otro se guarda como `unknown`. */
export type ContentType =
  'text' | 'image' | 'video' | 'audio' | 'file' | 'share' | 'story_mention' | 'reel' | 'unknown';

export interface Message {
  id: Id;
  conversationId: Id;
  externalMessageId: string | null;
  direction: MessageDirection;
  origin: MessageOrigin;
  senderEmployeeId: Id | null;
  body: string | null;
  contentType: ContentType;
  attachmentRef: string | null;
  providerTimestampUtc: IsoUtc | null;
  ingestedAtUtc: IsoUtc;
  deliveryStatus: DeliveryStatus;
  replyToMessageId: Id | null;
}

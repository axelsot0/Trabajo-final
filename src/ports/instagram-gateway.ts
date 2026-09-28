import type { IsoUtc } from '../domain/time.ts';

export interface SendTextInput {
  /** ID de la cuenta profesional (ig_user_id), dueña del token. */
  igUserId: string;
  /** Nombre del secreto con el token; el adaptador lo resuelve, el dominio nunca lo ve. */
  tokenReference: string;
  /** IGSID del cliente tal como llegó en el webhook. */
  recipientId: string;
  text: string;
  /** Solo respuestas humanas y solo si Meta habilitó la etiqueta (ADR 0002). */
  humanAgentTag: boolean;
}

export type SendTextResult =
  | { ok: true; messageId: string; recipientId: string | null }
  | {
      ok: false;
      kind: 'rejected';
      httpStatus: number;
      /** Código estable derivado de la respuesta de Meta, apto para mostrar al agente. */
      errorCode: string;
      retryable: boolean;
      /** `true` cuando el token fue rechazado y la cuenta debe marcarse `token_invalid`. */
      tokenInvalid: boolean;
    }
  | {
      /** Timeout o fallo de red: no sabemos si Meta recibió el envío. Conciliar antes de reintentar. */
      ok: false;
      kind: 'uncertain';
      errorCode: string;
    };

export interface RemoteMessage {
  mid: string;
  fromId: string | null;
  text: string | null;
  createdTimeUtc: IsoUtc | null;
}

export interface ListRecentMessagesInput {
  igUserId: string;
  tokenReference: string;
  recipientId: string;
}

export type ListRecentMessagesResult =
  { ok: true; messages: RemoteMessage[] } | { ok: false; errorCode: string };

export interface InstagramGateway {
  sendText(input: SendTextInput): Promise<SendTextResult>;
  /** Mensajes recientes de la conversación con el cliente (Conversations API), para conciliar. */
  listRecentMessages(input: ListRecentMessagesInput): Promise<ListRecentMessagesResult>;
}

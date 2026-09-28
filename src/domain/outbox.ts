import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type OutboxOperation = 'instagram.send_text';
export type OutboxStatus = 'pending' | 'in_flight' | 'sent' | 'failed' | 'uncertain' | 'cancelled';

export interface OutboxItem {
  id: Id;
  conversationId: Id;
  messageId: Id | null;
  operation: OutboxOperation;
  /** JSON mínimo para ejecutar la operación; nunca tokens. */
  payloadMinimal: string;
  status: OutboxStatus;
  retryAtUtc: IsoUtc | null;
  attempts: number;
  lastErrorCode: string | null;
  remoteMessageId: string | null;
  /** Versión de la conversación al encolar; el despacho la compara para descartar trabajos atrasados. */
  conversationVersion: number;
  createdAtUtc: IsoUtc;
  updatedAtUtc: IsoUtc;
}

/** Payload de `instagram.send_text`. */
export interface SendTextPayload {
  text: string;
  /** Quién origina el envío: decide la ventana aplicable y las revalidaciones. */
  senderKind: 'ai' | 'human';
  senderEmployeeId: Id | null;
}

export const OUTBOX_MAX_ATTEMPTS = 5;

/** Backoff por intento (índice = intentos ya realizados). */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export function nextRetryDelayMs(attemptsSoFar: number): number | null {
  if (attemptsSoFar >= OUTBOX_MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.min(attemptsSoFar, RETRY_DELAYS_MS.length) - 1] ?? null;
}

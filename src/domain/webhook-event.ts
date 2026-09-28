import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type WebhookProvider = 'meta' | 'telegram';
export type WebhookProcessStatus = 'pending' | 'processing' | 'done' | 'failed' | 'ignored';

export interface WebhookEvent {
  id: Id;
  provider: WebhookProvider;
  /** Clave idempotente derivada del proveedor (p. ej. `meta:<mid>`). */
  externalEventKey: string;
  receivedAtUtc: IsoUtc;
  processStatus: WebhookProcessStatus;
  attempts: number;
  errorCode: string | null;
  /** JSON normalizado y mínimo, suficiente para reprocesar; retención corta. */
  payloadMinimal: string;
  processedAtUtc: IsoUtc | null;
}

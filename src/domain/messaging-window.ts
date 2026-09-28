import { fromIsoUtc, MS_PER_DAY, MS_PER_HOUR, type IsoUtc } from './time.ts';

/** Ventana estándar de respuesta de Meta: 24 h desde el último mensaje del cliente. */
export const STANDARD_WINDOW_MS = 24 * MS_PER_HOUR;
/** Extensión Human Agent: hasta 7 días, solo respuestas humanas y solo si está habilitada. */
export const HUMAN_AGENT_WINDOW_MS = 7 * MS_PER_DAY;

export type SenderKind = 'ai' | 'human';

export type SendWindowDecision =
  | { allowed: true; tag: 'HUMAN_AGENT' | null; remainingMs: number }
  | { allowed: false; reason: 'no_customer_message' | 'window_expired' };

export interface SendWindowInput {
  lastCustomerMessageAtUtc: IsoUtc | null;
  now: Date;
  senderKind: SenderKind;
  humanAgentEnabled: boolean;
}

/**
 * Decide si un envío es elegible ahora. Se llama justo antes de cada envío, nunca
 * se cachea. Al borde exacto (transcurridas 24 h completas) la ventana se considera
 * cerrada: preferimos no enviar a arriesgar una violación de política.
 */
export function evaluateSendWindow(input: SendWindowInput): SendWindowDecision {
  if (input.lastCustomerMessageAtUtc === null) {
    return { allowed: false, reason: 'no_customer_message' };
  }
  const elapsed = input.now.getTime() - fromIsoUtc(input.lastCustomerMessageAtUtc).getTime();
  if (elapsed < 0) {
    // Reloj del proveedor por delante del nuestro: tratamos como recién recibido.
    return { allowed: true, tag: null, remainingMs: STANDARD_WINDOW_MS };
  }
  if (elapsed < STANDARD_WINDOW_MS) {
    return { allowed: true, tag: null, remainingMs: STANDARD_WINDOW_MS - elapsed };
  }
  if (input.senderKind === 'human' && input.humanAgentEnabled && elapsed < HUMAN_AGENT_WINDOW_MS) {
    return { allowed: true, tag: 'HUMAN_AGENT', remainingMs: HUMAN_AGENT_WINDOW_MS - elapsed };
  }
  return { allowed: false, reason: 'window_expired' };
}

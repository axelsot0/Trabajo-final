import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type OutcomeKind = 'venta_confirmada' | 'sin_venta' | 'seguimiento' | 'no_determinado';

export const OUTCOME_KINDS: readonly OutcomeKind[] = [
  'venta_confirmada',
  'sin_venta',
  'seguimiento',
  'no_determinado',
];

export const outcomeLabel: Record<OutcomeKind, string> = {
  venta_confirmada: 'Venta confirmada',
  sin_venta: 'Sin venta',
  seguimiento: 'Seguimiento',
  no_determinado: 'No determinado',
};

export function isOutcomeKind(value: string): value is OutcomeKind {
  return (OUTCOME_KINDS as readonly string[]).includes(value);
}

export interface Outcome {
  id: Id;
  conversationId: Id;
  kind: OutcomeKind;
  /** Importe en unidades menores (centavos). Opcional y declarado por el agente. */
  amountMinor: number | null;
  /** ISO 4217, p. ej. `DOP`, `USD`. */
  currency: string | null;
  evidenceNote: string | null;
  recordedBy: Id;
  recordedAtUtc: IsoUtc;
}

export interface ParsedAmount {
  amountMinor: number;
  currency: string;
  note: string | null;
}

/**
 * Interpreta `1500`, `1,500.50 DOP`, `2500 USD entregado en tienda`. Sin moneda usa la
 * predeterminada del negocio. Devuelve `null` si no hay un importe válido.
 */
export function parseAmount(input: string, defaultCurrency: string): ParsedAmount | null {
  const match = /^\s*([0-9][0-9.,]*)\s*([A-Za-z]{3})?\s*(.*)$/s.exec(input);
  if (!match) return null;
  const rawNumber = (match[1] ?? '').replaceAll(',', '');
  if (!/^\d+(\.\d{1,2})?$/.test(rawNumber)) return null;
  const [whole = '0', fraction = ''] = rawNumber.split('.');
  const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const currency = (match[2] ?? defaultCurrency).toUpperCase();
  const note = (match[3] ?? '').trim();
  return { amountMinor, currency, note: note.length > 0 ? note : null };
}

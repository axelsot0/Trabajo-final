import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export interface VolumeTier {
  minQty: number;
  unitPriceMinor: number;
}

export interface CatalogItem {
  id: Id;
  name: string;
  description: string;
  currency: string;
  listUnitPriceMinor: number;
  volumeTiers: VolumeTier[];
  /** Piso para negociación humana; nunca se incluye en el prompt de la IA. */
  minUnitPriceMinor: number | null;
  quantityAvailable: number;
  handoffMinQty: number;
  facts: string[];
  active: boolean;
  version: number;
  updatedAtUtc: IsoUtc;
}

export interface Quote {
  qty: number;
  unitPriceMinor: number;
  totalMinor: number;
}

/** Precio unitario aprobado para `qty`: el tramo de mayor `minQty` que aplique. */
export function unitPriceFor(item: CatalogItem, qty: number): number {
  let price = item.listUnitPriceMinor;
  let best = 0;
  for (const tier of item.volumeTiers) {
    if (qty >= tier.minQty && tier.minQty > best) {
      best = tier.minQty;
      price = tier.unitPriceMinor;
    }
  }
  return price;
}

/** Cotizaciones aprobadas para cada cantidad posible (1..existencias). */
export function approvedQuotes(item: CatalogItem): Quote[] {
  const quotes: Quote[] = [];
  for (let qty = 1; qty <= item.quantityAvailable; qty += 1) {
    const unitPriceMinor = unitPriceFor(item, qty);
    quotes.push({ qty, unitPriceMinor, totalMinor: unitPriceMinor * qty });
  }
  return quotes;
}

/** Montos (en unidades mayores) que un texto automático puede mencionar. */
export function approvedAmounts(items: CatalogItem[]): Set<number> {
  const amounts = new Set<number>();
  for (const item of items) {
    if (!item.active) continue;
    for (const q of approvedQuotes(item)) {
      amounts.add(q.unitPriceMinor / 100);
      amounts.add(q.totalMinor / 100);
    }
  }
  return amounts;
}

/**
 * Extrae montos de dinero de un texto en español: `RD$21,000`, `$ 21.000`, `21000`,
 * `21 mil`, `21k`. Ignora números pequeños sin marca monetaria (edades, cantidades).
 */
export function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  // Teléfonos (809-555-1234) no son montos.
  const withoutPhones = text.replace(/\b\d{3}[-\s.]\d{3}[-\s.]\d{4}\b|\b\d{10}\b/g, ' ');
  const pattern =
    /(RD\s?\$|\$|US\$)?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil\b|k\b|pesos\b)?/gi;
  for (const match of withoutPhones.matchAll(pattern)) {
    const [, currency, rawNumber, suffix] = match;
    if (rawNumber === undefined) continue;
    const hasThousandsSeparators = /^\d{1,3}(?:[.,]\d{3})+$/.test(rawNumber);
    const numeric = hasThousandsSeparators
      ? Number(rawNumber.replace(/[.,]/g, ''))
      : Number(rawNumber.replace(',', '.'));
    if (!Number.isFinite(numeric)) continue;
    const unit = suffix?.toLowerCase();
    const value = unit === 'mil' || unit === 'k' ? numeric * 1000 : numeric;
    const monetary = currency !== undefined || unit !== undefined || value >= 1000;
    if (monetary) amounts.push(Math.round(value));
  }
  return amounts;
}

/** Montos del texto que no están aprobados. Vacío = el texto es seguro en precios. */
export function unapprovedAmounts(text: string, approved: Set<number>): number[] {
  return extractAmounts(text).filter((amount) => !approved.has(amount));
}

/** `2100000` → `RD$21,000` (sin decimales cuando son cero). */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const symbol = currency === 'DOP' ? 'RD$' : `${currency} `;
  const formatted = major.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

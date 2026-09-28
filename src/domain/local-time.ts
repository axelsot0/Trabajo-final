import { fromIsoUtc, type IsoUtc } from './time.ts';

/**
 * Presenta una marca UTC en la zona IANA del negocio. Nunca se deriva del reloj del
 * servidor: la zona se guarda junto al negocio y el instante viene de Meta.
 */
export function formatLocal(isoUtc: IsoUtc, timeZone: string): string {
  const date = fromIsoUtc(isoUtc);
  return new Intl.DateTimeFormat('es-DO', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export interface LocalParts {
  /** Hora local 0–23. */
  hour: number;
  /** Día de la semana ISO: 1 = lunes … 7 = domingo. */
  isoWeekday: number;
  /** Fecha local `YYYY-MM-DD`. */
  date: string;
}

const weekdayIndex: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Descompone un instante UTC en partes locales para análisis por hora y día. */
export function localParts(isoUtc: IsoUtc, timeZone: string): LocalParts {
  const date = fromIsoUtc(isoUtc);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // `hour12: false` puede devolver "24" a medianoche en algunos motores.
  const hour = Number(get('hour')) % 24;
  return {
    hour,
    isoWeekday: weekdayIndex[get('weekday')] ?? 0,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Marca de tiempo ISO 8601 en UTC, p. ej. `2026-09-27T14:03:00.000Z`. */
export type IsoUtc = string;

export function toIsoUtc(date: Date): IsoUtc {
  return date.toISOString();
}

export function fromIsoUtc(value: IsoUtc): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Marca de tiempo inválida: ${value}`);
  }
  return date;
}

/** Meta entrega `timestamp` en milisegundos desde época Unix. */
export function fromUnixMillis(ms: number): Date {
  return new Date(ms);
}

export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

import { describe, expect, it } from 'vitest';

import { parseAmount } from '../../src/domain/outcome.ts';

describe('parseAmount', () => {
  it('interpreta importes con y sin moneda, con nota opcional', () => {
    expect(parseAmount('1500', 'DOP')).toEqual({
      amountMinor: 150_000,
      currency: 'DOP',
      note: null,
    });
    expect(parseAmount(' 1,500.50 usd entregado en tienda', 'DOP')).toEqual({
      amountMinor: 150_050,
      currency: 'USD',
      note: 'entregado en tienda',
    });
    expect(parseAmount('99.9', 'DOP')).toEqual({ amountMinor: 9_990, currency: 'DOP', note: null });
  });

  it('rechaza importes inválidos o cero', () => {
    expect(parseAmount('', 'DOP')).toBeNull();
    expect(parseAmount('abc', 'DOP')).toBeNull();
    expect(parseAmount('0', 'DOP')).toBeNull();
    expect(parseAmount('12.345', 'DOP')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  approvedAmounts,
  approvedQuotes,
  extractAmounts,
  formatMoney,
  unapprovedAmounts,
} from '../../src/domain/catalog.ts';
import { YORKIES } from '../support/catalog.ts';

describe('precios aprobados', () => {
  it('aplica el tramo por volumen de mayor cantidad mínima', () => {
    expect(approvedQuotes(YORKIES).map((q) => [q.qty, q.unitPriceMinor, q.totalMinor])).toEqual([
      [1, 2_100_000, 2_100_000],
      [2, 2_100_000, 4_200_000],
      [3, 1_800_000, 5_400_000],
      [4, 1_800_000, 7_200_000],
      [5, 1_600_000, 8_000_000],
    ]);
  });

  it('los montos aprobados incluyen unitarios y totales, nunca el piso de negociación aislado', () => {
    const amounts = approvedAmounts([YORKIES]);
    for (const a of [21_000, 42_000, 18_000, 54_000, 72_000, 16_000, 80_000]) {
      expect(amounts.has(a)).toBe(true);
    }
    expect(amounts.has(17_000)).toBe(false);
  });

  it('formatea pesos dominicanos', () => {
    expect(formatMoney(2_100_000, 'DOP')).toBe('RD$21,000');
  });
});

describe('extractAmounts', () => {
  it.each([
    ['Cuesta RD$21,000', [21_000]],
    ['son $ 21.000 pesos', [21_000]],
    ['te lo dejo en 21000', [21_000]],
    ['me lo dejas en 17 mil?', [17_000]],
    ['15k y cerramos', [15_000]],
    ['tienen 2 meses y quedan 5', []],
    ['llámame al 809-555-1234', []],
  ])('%s', (text, expected) => {
    expect(extractAmounts(text)).toEqual(expected);
  });

  it('detecta montos no aprobados en una respuesta', () => {
    const approved = approvedAmounts([YORKIES]);
    expect(unapprovedAmounts('Cada uno cuesta RD$21,000 🐶', approved)).toEqual([]);
    expect(unapprovedAmounts('Te lo dejo en RD$19,500', approved)).toEqual([19_500]);
  });
});

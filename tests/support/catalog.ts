import type { CatalogItem } from '../../src/domain/catalog.ts';

/** Catálogo de referencia del piloto: 5 yorkies, RD$21,000; 3+ a RD$18,000; 5 a RD$16,000. */
export const YORKIES: CatalogItem = {
  id: 'yorkie',
  name: 'Cachorro Yorkshire Terrier',
  description: 'Yorkshire terrier de 2 meses de nacido',
  currency: 'DOP',
  listUnitPriceMinor: 2_100_000,
  volumeTiers: [
    { minQty: 3, unitPriceMinor: 1_800_000 },
    { minQty: 5, unitPriceMinor: 1_600_000 },
  ],
  minUnitPriceMinor: 1_800_000,
  quantityAvailable: 5,
  handoffMinQty: 3,
  facts: ['2 meses de nacidos'],
  active: true,
  version: 1,
  updatedAtUtc: '2026-09-28T00:00:00.000Z',
};

import { z } from 'zod';

import type { CatalogItem, VolumeTier } from '../../domain/catalog.ts';
import type { CatalogRepository } from '../../ports/repositories.ts';

interface CatalogItemRow {
  id: string;
  name: string;
  description: string;
  currency: string;
  list_unit_price_minor: number;
  volume_tiers_json: string;
  min_unit_price_minor: number | null;
  quantity_available: number;
  handoff_min_qty: number;
  facts_json: string;
  active: number;
  version: number;
  updated_at_utc: string;
}

const tiersSchema = z.array(
  z.object({ minQty: z.number().int().positive(), unitPriceMinor: z.number().int().positive() }),
);
const factsSchema = z.array(z.string());

/** JSON mal formado en el catálogo no rompe el Worker: se trata como vacío. */
function parseOr<T>(schema: z.ZodType<T>, raw: string, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function toCatalogItem(row: CatalogItemRow): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currency: row.currency,
    listUnitPriceMinor: row.list_unit_price_minor,
    volumeTiers: parseOr<VolumeTier[]>(tiersSchema, row.volume_tiers_json, []),
    minUnitPriceMinor: row.min_unit_price_minor,
    quantityAvailable: row.quantity_available,
    handoffMinQty: row.handoff_min_qty,
    facts: parseOr(factsSchema, row.facts_json, []),
    active: row.active === 1,
    version: row.version,
    updatedAtUtc: row.updated_at_utc,
  };
}

export class D1CatalogRepository implements CatalogRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(): Promise<CatalogItem[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM catalog_items WHERE active = 1 ORDER BY name')
      .all<CatalogItemRow>();
    return results.map(toCatalogItem);
  }

  async upsert(item: CatalogItem): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO catalog_items
           (id, name, description, currency, list_unit_price_minor, volume_tiers_json,
            min_unit_price_minor, quantity_available, handoff_min_qty, facts_json, active,
            version, updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           currency = excluded.currency,
           list_unit_price_minor = excluded.list_unit_price_minor,
           volume_tiers_json = excluded.volume_tiers_json,
           min_unit_price_minor = excluded.min_unit_price_minor,
           quantity_available = excluded.quantity_available,
           handoff_min_qty = excluded.handoff_min_qty,
           facts_json = excluded.facts_json,
           active = excluded.active,
           version = catalog_items.version + 1,
           updated_at_utc = excluded.updated_at_utc`,
      )
      .bind(
        item.id,
        item.name,
        item.description,
        item.currency,
        item.listUnitPriceMinor,
        JSON.stringify(item.volumeTiers),
        item.minUnitPriceMinor,
        item.quantityAvailable,
        item.handoffMinQty,
        JSON.stringify(item.facts),
        item.active ? 1 : 0,
        item.version,
        item.updatedAtUtc,
      )
      .run();
  }
}

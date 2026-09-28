-- Catálogo inicial del piloto (Yorki Cuties). Datos de negocio, no de esquema: se
-- aplica una vez y se vuelve a aplicar para actualizar precios o existencias.
--   npx wrangler d1 execute DB --remote --file seeds/yorki-cuties.sql
-- Precios en unidades menores (centavos): RD$21,000 = 2100000.
--   1–2 cachorros: RD$21,000 c/u (la IA nunca baja de aquí)
--   3–4 cachorros: RD$18,000 c/u      5 cachorros: RD$16,000 c/u
--   Piso para negociación humana (1–2): RD$18,000. Nunca llega a la IA.
INSERT INTO catalog_items
  (id, name, description, currency, list_unit_price_minor, volume_tiers_json,
   min_unit_price_minor, quantity_available, handoff_min_qty, facts_json, active,
   version, updated_at_utc)
VALUES
  ('yorkie-2026-09', 'Cachorro Yorkshire Terrier', 'Cachorros Yorkshire terrier de 2 meses de nacidos',
   'DOP', 2100000, '[{"minQty":3,"unitPriceMinor":1800000},{"minQty":5,"unitPriceMinor":1600000}]',
   1800000, 5, 3, '["Raza: Yorkshire terrier","Edad: 2 meses de nacidos"]', 1,
   1, '2026-09-28T00:00:00.000Z')
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
  updated_at_utc = excluded.updated_at_utc;

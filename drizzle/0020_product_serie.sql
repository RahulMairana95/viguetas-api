-- Serie de vigueta (M1–M7: cuántos hilos) y unicidad por longitud+serie.
-- Las viguetas antiguas quedan con serie NULL (no participan del índice).
-- Idempotente: esta migración ya se había aplicado a mano sobre la BD, así que
-- cada paso tolera que el objeto ya exista.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "serie" varchar(3);--> statement-breakpoint
DROP INDEX IF EXISTS "products_vigueta_longitud_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_vigueta_longitud_serie_unique"
  ON "products" ("longitud", "serie")
  WHERE "product_type" = 'vigueta' AND "longitud" IS NOT NULL AND "serie" IS NOT NULL;

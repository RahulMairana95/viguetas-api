-- Serie de vigueta (M1–M7: cuántos hilos) y unicidad por longitud+serie.
-- Las viguetas antiguas quedan con serie NULL (no participan del índice).
ALTER TABLE "products" ADD COLUMN "serie" varchar(3);--> statement-breakpoint
DROP INDEX "products_vigueta_longitud_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "products_vigueta_longitud_serie_unique"
  ON "products" ("longitud", "serie")
  WHERE "product_type" = 'vigueta' AND "longitud" IS NOT NULL AND "serie" IS NOT NULL;

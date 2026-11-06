-- Medidas estructuradas por tipo de producto.
-- Se elimina measurement (texto libre) y se reemplaza por:
--   vigueta → longitud en metros (1.0–12.0, múltiplos de 0.1 = 10 cm)
--   plastoformo → grosor/ancho/largo en cm (enteros 1–500)
ALTER TABLE "products" ADD COLUMN "longitud" numeric(4,1);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "grosor" integer;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ancho" integer;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "largo" integer;
--> statement-breakpoint
-- Backfill viguetas: parsear el número inicial de measurement
-- (ej. "4.6m" → 4.6, "6 m" → 6.0). Los valores fuera de rango o que no se
-- puedan parsear quedan NULL y el admin los corrige editando el producto.
-- Los plastoformos no se pueden parsear de forma fiable de texto libre
-- ("15×20 cm") y quedan en NULL hasta que un admin cargue sus medidas.
UPDATE "products"
SET "longitud" = ROUND(
  replace(substring("measurement" from '^[0-9]+([.,][0-9]+)?'), ',', '.')::numeric,
  1
)
WHERE "product_type" = 'vigueta'
  AND "measurement" ~ '^[0-9]+([.,][0-9]+)?';
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "measurement";

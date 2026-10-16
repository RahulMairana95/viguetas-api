-- Tipo de venta: inmediata vs programada (pedido).
-- Se guarda explícito: una inmediata y un pedido entregado comparten status
-- 'completed', así que por estado no se pueden distinguir.
ALTER TABLE "sales" ADD COLUMN "es_programada" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill: las ventas con fecha de entrega eran programadas.
UPDATE "sales" SET "es_programada" = true WHERE "delivery_date" IS NOT NULL;

-- Cotizaciones independientes (patrón "puntales"): 100% sin foreign keys.
-- Una cotización es un documento que se le manda al cliente: sus datos son un
-- SNAPSHOT (cliente, producto, medidas, serie, usuario) guardados como texto,
-- así si se borra un cliente/producto/venta la cotización no cambia ni truena.
-- Solo queda `sale_id` como uuid suelto (referencia blanda, sin constraint).

-- 1) Se sueltan todas las foreign keys
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_sale_id_sales_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_user_id_users_id_fk";
--> statement-breakpoint
-- 2) quotes: cliente y usuario pasan a texto; se copia el teléfono y el total
ALTER TABLE "quotes" ADD COLUMN "client_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "client_phone" varchar(50);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "user_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "total" decimal(10,2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "client_id";
--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "user_id";
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "client_name" SET NOT NULL;
--> statement-breakpoint
-- 3) quote_items: snapshot del producto (nombre, tipo, serie y medidas)
ALTER TABLE "quote_items" ADD COLUMN "product_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "product_type" varchar(20);
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "serie" varchar(3);
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "longitud_producto" numeric(4,1);
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "grosor" integer;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "ancho" integer;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "largo" integer;
--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "product_name" SET NOT NULL;
--> statement-breakpoint
-- 4) Índice sobre el uuid suelto de quote_id (ya no hay constraint)
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items" ("quote_id");

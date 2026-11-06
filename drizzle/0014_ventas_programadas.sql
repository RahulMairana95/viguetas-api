-- Parte B — Ventas programadas (reemplaza Traslados y Pedidos).
-- Caso A: los datos existentes eran de PRUEBA, se vacían antes de migrar.
-- (El stock no se toca: se recarga con "Cargar / Ajustar stock" después.)
TRUNCATE TABLE sale_items, sales, transfer_items, transfers, order_items, orders, productions CASCADE;
--> statement-breakpoint
-- Estado de venta: programada / entregada / cancelada
CREATE TYPE "public"."sale_status" AS ENUM('scheduled', 'completed', 'cancelled');
--> statement-breakpoint
-- sales: nuevos campos de venta programada
ALTER TABLE "sales" ADD COLUMN "status" "sale_status" DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "delivery_date" date;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "delivery_place" varchar(500);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "delivered_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "warehouse_id";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "order_id";
--> statement-breakpoint
-- sale_items: el origen de cada línea vive en la línea, no en la venta
ALTER TABLE "sale_items" ADD COLUMN "warehouse_id" uuid;
--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "warehouse_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- productions: el vínculo pasa de pedido a venta programada
ALTER TABLE "productions" DROP COLUMN "order_id";
--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "sale_id" uuid;
--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Se eliminan Traslados y Pedidos
DROP TABLE "transfer_items";
--> statement-breakpoint
DROP TABLE "transfers";
--> statement-breakpoint
DROP TABLE "order_items";
--> statement-breakpoint
DROP TABLE "orders";
--> statement-breakpoint
DROP TYPE "public"."order_status";

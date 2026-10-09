ALTER TABLE "orders" ADD COLUMN "advance" numeric(10, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_price" numeric(10, 2);

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "address" varchar(500);--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "phone" varchar(50);

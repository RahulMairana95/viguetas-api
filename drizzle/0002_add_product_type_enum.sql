CREATE TYPE "public"."product_type" AS ENUM('vigueta', 'plastoformo');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_type" "product_type" DEFAULT 'vigueta' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "material";

-- Cotizaciones: presupuesto previo al pedido. NO toca stock ni tiene origen.
-- Cuando el cliente acepta, se convierte en pedido (venta programada) y se
-- guarda el saleId resultante.
CREATE TYPE "quote_status" AS ENUM('open', 'converted', 'cancelled');
--> statement-breakpoint
-- numero: serie consecutiva "Cot. 1, Cot. 2, …" que asigna Postgres sola.
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" serial NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'open' NOT NULL,
	"sale_id" uuid,
	"user_id" uuid NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
-- Líneas sin almacén de origen: en la cotización aún no se sabe de dónde sale.
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" decimal(10,2),
	"longitud" varchar(50)
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;

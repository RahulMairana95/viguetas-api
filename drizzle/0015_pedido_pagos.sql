-- Pedidos: pagos y metadatos.
-- El saldo NUNCA se guarda: se deriva siempre como total − adelanto.
ALTER TABLE "sales" ADD COLUMN "adelanto" numeric(10, 2) DEFAULT '0';
--> statement-breakpoint
-- Fecha de registro del pedido (editable); date para evitar corrimiento de día.
ALTER TABLE "sales" ADD COLUMN "registered_date" date DEFAULT CURRENT_DATE NOT NULL;
--> statement-breakpoint
-- Líneas: longitud del producto (ej. viguetas de 5 m)
ALTER TABLE "sale_items" ADD COLUMN "longitud" varchar(50);

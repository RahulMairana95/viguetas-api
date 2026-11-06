-- Unicidad de medidas por tipo de producto:
-- una vigueta por longitud y un plastoformo por combinación grosor×ancho×largo.
-- (Antes de aplicar se borró el duplicado de prueba "vigueta duplicado" con longitud 3.5.)
CREATE UNIQUE INDEX "products_vigueta_longitud_unique"
  ON "products" ("longitud")
  WHERE "product_type" = 'vigueta' AND "longitud" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "products_plastoformo_dims_unique"
  ON "products" ("grosor", "ancho", "largo")
  WHERE "product_type" = 'plastoformo' AND "grosor" IS NOT NULL AND "ancho" IS NOT NULL AND "largo" IS NOT NULL;

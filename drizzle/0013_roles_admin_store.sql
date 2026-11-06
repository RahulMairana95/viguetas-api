-- Roles: 2 roles efectivos (admin / store). Se descarta superadmin.
-- La base tenía 'promoter' (renombrado en 0009): se revierte el nombre a 'store'.
ALTER TYPE "public"."role" RENAME VALUE 'promoter' TO 'store';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'store';
--> statement-breakpoint
-- Usuarios desactivables (no se borran) y protegidos (solo desde la BD/script).
ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_protected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Los superadmin existentes pasan a admin, asignados al almacén de tipo fábrica
-- (admin solo puede tener almacén factory). Ejecutar ANTES de desplegar el código.
UPDATE "users"
SET "role" = 'admin',
    "warehouse_id" = (SELECT "id" FROM "warehouses" WHERE "type" = 'factory' LIMIT 1)
WHERE "role" = 'superadmin';

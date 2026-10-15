-- Quedan solo 2 roles: admin y promoter (se elimina el residual superadmin).
-- Se recrea el enum porque Postgres no permite DROP VALUE dentro de una transacción.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" TYPE text USING "role"::text;
--> statement-breakpoint
DROP TYPE "public"."role";
--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'promoter');
--> statement-breakpoint
UPDATE "users" SET "role" = 'promoter' WHERE "role" = 'store';
--> statement-breakpoint
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'superadmin';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."role" USING "role"::"public"."role";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'promoter';

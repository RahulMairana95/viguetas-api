ALTER TYPE "public"."role" RENAME VALUE 'store' TO 'promoter';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'promoter';

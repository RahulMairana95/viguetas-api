CREATE TYPE "public"."puntal_material" AS ENUM('madera', 'metal', 'solera');--> statement-breakpoint
CREATE TYPE "public"."puntal_status" AS ENUM('en_obra', 'en_almacen');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "puntales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"loan_date" timestamp NOT NULL,
	"pickup_date" timestamp NOT NULL,
	"material" "puntal_material" NOT NULL,
	"quantity" integer NOT NULL,
	"place" varchar(500) NOT NULL,
	"description" text,
	"status" "puntal_status" DEFAULT 'en_obra' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

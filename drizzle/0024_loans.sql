CREATE TYPE "public"."loan_type" AS ENUM('KUNI', 'GRADING');--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "loan_type" "loan_type" DEFAULT 'KUNI' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "currency" "currency" DEFAULT 'TZS' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "fx_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "total_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "total_interest_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD COLUMN "loan_type" "loan_type" DEFAULT 'KUNI' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD COLUMN "amount_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD COLUMN "interest_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "loan_type" "loan_type" DEFAULT 'KUNI' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "amount_per_acre_usd" numeric(14, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "kuni_settings_amcos_season_type_idx" ON "kuni_settings" USING btree ("amcos_id","season_id","loan_type");--> statement-breakpoint
DROP INDEX IF EXISTS "kuni_settings_amcos_id_season_id_index";

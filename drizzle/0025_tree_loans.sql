ALTER TYPE "public"."loan_type" ADD VALUE IF NOT EXISTS 'TREES';--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD COLUMN "total_trees" integer;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD COLUMN "trees" integer;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "area_unit" text DEFAULT 'HECTARE' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "trees_per_area" integer;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "cost_per_tree_usd" numeric(12, 4);
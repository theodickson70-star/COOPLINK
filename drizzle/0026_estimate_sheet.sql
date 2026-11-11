ALTER TYPE "public"."input_unit" ADD VALUE IF NOT EXISTS 'BOTTLE';--> statement-breakpoint
ALTER TYPE "public"."input_unit" ADD VALUE IF NOT EXISTS 'SPOOL';--> statement-breakpoint
ALTER TYPE "public"."input_unit" ADD VALUE IF NOT EXISTS 'METRE';--> statement-breakpoint
CREATE TABLE "estimate_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"quantity" numeric(16, 4) NOT NULL,
	"kg" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "kg_per_acre" numeric(10, 2) DEFAULT '560' NOT NULL;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "ttb_no" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "barns_existing" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "barns_new" integer;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "maize_acres" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tree_acres" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "kuni_trips" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "grading_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "limit_basis" text DEFAULT 'ACRE' NOT NULL;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD COLUMN "price_per_trip_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "estimate_inputs" ADD CONSTRAINT "estimate_inputs_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_inputs" ADD CONSTRAINT "estimate_inputs_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_inputs_estimate_id_input_item_id_index" ON "estimate_inputs" USING btree ("estimate_id","input_item_id");--> statement-breakpoint
CREATE INDEX "estimate_inputs_input_item_id_index" ON "estimate_inputs" USING btree ("input_item_id");
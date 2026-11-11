ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'FX_ADJUSTMENT';--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"usd_to_tzs" numeric(12, 4) NOT NULL,
	"note" text,
	"set_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_usd_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"season_id" uuid,
	"kind" text NOT NULL,
	"usd" numeric(14, 2) NOT NULL,
	"tzs" numeric(14, 2) NOT NULL,
	"rate" numeric(12, 4),
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Vyama vilivyopo vinabaki TSh (bei na madeni yao ya sasa ni ya TSh); Mhasibu anabadilisha kwenda USD kwenye Fedha.
ALTER TABLE "amcos" ADD COLUMN "input_currency" "currency" DEFAULT 'TZS' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "amount_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "fx_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "input_issue_lines" ADD COLUMN "unit_price_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "input_issue_lines" ADD COLUMN "amount_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "currency" "currency" DEFAULT 'TZS' NOT NULL;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "fx_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "total_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "input_prices" ADD COLUMN "unit_price_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD COLUMN "unit_cost_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD COLUMN "amount_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "currency" "currency" DEFAULT 'TZS' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "fx_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "total_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_usd_ledger" ADD CONSTRAINT "member_usd_ledger_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_usd_ledger" ADD CONSTRAINT "member_usd_ledger_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_rates_amcos_id_created_at_index" ON "fx_rates" USING btree ("amcos_id","created_at");--> statement-breakpoint
CREATE INDEX "member_usd_ledger_amcos_id_member_id_index" ON "member_usd_ledger" USING btree ("amcos_id","member_id");--> statement-breakpoint
CREATE INDEX "member_usd_ledger_reference_type_reference_id_index" ON "member_usd_ledger" USING btree ("reference_type","reference_id");
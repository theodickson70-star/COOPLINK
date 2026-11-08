ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'KUNI_BATCH';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE IF NOT EXISTS 'LOAN_INTEREST';--> statement-breakpoint
CREATE TABLE "kuni_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"status" "payment_batch_status" DEFAULT 'DRAFT' NOT NULL,
	"interest_rate" numeric(6, 3) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"total_interest" numeric(18, 2) NOT NULL,
	"approval_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kuni_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"interest" numeric(18, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" text,
	"destination" text NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"finance_txn_id" uuid,
	"provider_ref" text,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kuni_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"interest_rate" numeric(6, 3) DEFAULT '0' NOT NULL,
	"amount_per_acre" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD CONSTRAINT "kuni_batches_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_batches" ADD CONSTRAINT "kuni_batches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD CONSTRAINT "kuni_loans_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD CONSTRAINT "kuni_loans_batch_id_kuni_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."kuni_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD CONSTRAINT "kuni_loans_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_loans" ADD CONSTRAINT "kuni_loans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD CONSTRAINT "kuni_settings_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kuni_settings" ADD CONSTRAINT "kuni_settings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kuni_batches_amcos_id_batch_no_index" ON "kuni_batches" USING btree ("amcos_id","batch_no");--> statement-breakpoint
CREATE INDEX "kuni_loans_batch_id_index" ON "kuni_loans" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "kuni_loans_amcos_id_season_id_member_id_index" ON "kuni_loans" USING btree ("amcos_id","season_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kuni_settings_amcos_id_season_id_index" ON "kuni_settings" USING btree ("amcos_id","season_id");
CREATE TYPE "public"."bale_status" AS ENUM('REGISTERED', 'GRADED', 'SOLD', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('TZS', 'USD');--> statement-breakpoint
CREATE TYPE "public"."deduction_basis" AS ENUM('PERCENT_OF_GROSS', 'PER_KG', 'FIXED', 'OUTSTANDING_LOAN');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('DRAFT', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE');--> statement-breakpoint
CREATE TYPE "public"."input_category" AS ENUM('FERTILIZER', 'SEED', 'CHEMICAL', 'PACKAGING', 'EQUIPMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."input_issue_status" AS ENUM('ISSUED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."input_unit" AS ENUM('BAG', 'KG', 'LITRE', 'ROLL', 'PIECE', 'PACKET');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('INPUT_LOAN', 'CASH_LOAN', 'TOBACCO_SALE', 'DEDUCTION', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL', 'OPENING_BALANCE');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'SUSPENDED', 'EXITED', 'DECEASED');--> statement-breakpoint
CREATE TYPE "public"."mobile_money_provider" AS ENUM('MPESA', 'AIRTEL_MONEY', 'MIXX_BY_YAS', 'HALOPESA', 'TPESA');--> statement-breakpoint
CREATE TYPE "public"."payment_batch_status" AS ENUM('DRAFT', 'APPROVED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('MOBILE_MONEY', 'BANK', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'UNION_ADMIN', 'UNION_VIEWER', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('PLANNING', 'ACTIVE', 'MARKETING', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "amcos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"union_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"reg_number" text,
	"region" text,
	"district" text,
	"ward" text,
	"village" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amcos_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid,
	"union_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"bale_no" text NOT NULL,
	"gross_kg" numeric(10, 2) NOT NULL,
	"net_kg" numeric(10, 2),
	"grade" text,
	"price_usd" numeric(10, 4),
	"value_usd" numeric(14, 2),
	"status" "bale_status" DEFAULT 'REGISTERED' NOT NULL,
	"reject_reason" text,
	"client_ref" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"amcos_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_amcos_id_key_pk" PRIMARY KEY("amcos_id","key")
);
--> statement-breakpoint
CREATE TABLE "deduction_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"basis" "deduction_basis" NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'TZS' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"farm_id" uuid,
	"buyer_id" uuid,
	"acres_planted" numeric(10, 2) NOT NULL,
	"estimated_kg" numeric(12, 2) NOT NULL,
	"status" "estimate_status" DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_date" date NOT NULL,
	"usd_to_tzs" numeric(12, 4) NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_rateDate_unique" UNIQUE("rate_date")
);
--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text,
	"village" text,
	"acres" numeric(10, 2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_issue_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_issue_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"quantity" numeric(14, 2) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"issue_no" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"status" "input_issue_status" DEFAULT 'ISSUED' NOT NULL,
	"notes" text,
	"issued_by_id" uuid,
	"cancelled_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"client_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "input_category" NOT NULL,
	"unit" "input_unit" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"buyer_id" uuid,
	"market_no" text NOT NULL,
	"market_date" date NOT NULL,
	"location" text,
	"status" "market_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid,
	"member_id" uuid NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"reversal_of_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_ledger_entries_reversalOfId_unique" UNIQUE("reversal_of_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"member_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"gender" "gender" NOT NULL,
	"date_of_birth" date,
	"nida_number" text,
	"phone" text,
	"village" text,
	"hamlet" text,
	"photo_url" text,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" date DEFAULT now() NOT NULL,
	"mobile_money_number" text,
	"mobile_money_provider" "mobile_money_provider",
	"mobile_money_name" text,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"preferred_payment" "payment_method" DEFAULT 'MOBILE_MONEY' NOT NULL,
	"shares_count" integer DEFAULT 0 NOT NULL,
	"next_of_kin_name" text,
	"next_of_kin_phone" text,
	"next_of_kin_relation" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"status" "payment_batch_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"batch_id" uuid,
	"settlement_id" uuid,
	"member_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"destination" text NOT NULL,
	"provider" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"provider_ref" text,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "season_status" DEFAULT 'PLANNING' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"deduction_rule_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"settlement_no" text NOT NULL,
	"total_kg" numeric(12, 2) NOT NULL,
	"gross_usd" numeric(14, 2) NOT NULL,
	"exchange_rate" numeric(12, 4) NOT NULL,
	"gross_tzs" numeric(18, 2) NOT NULL,
	"total_deductions" numeric(18, 2) NOT NULL,
	"net_tzs" numeric(18, 2) NOT NULL,
	"status" "settlement_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"status" "sms_status" DEFAULT 'QUEUED' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" numeric(14, 2) NOT NULL,
	"reference" text,
	"input_issue_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"reg_number" text,
	"region" text,
	"district" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"union_id" uuid,
	"amcos_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "amcos" ADD CONSTRAINT "amcos_union_id_unions_id_fk" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bales" ADD CONSTRAINT "bales_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bales" ADD CONSTRAINT "bales_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bales" ADD CONSTRAINT "bales_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_rules" ADD CONSTRAINT "deduction_rules_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deduction_rules" ADD CONSTRAINT "deduction_rules_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_issue_lines" ADD CONSTRAINT "input_issue_lines_input_issue_id_input_issues_id_fk" FOREIGN KEY ("input_issue_id") REFERENCES "public"."input_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_issue_lines" ADD CONSTRAINT "input_issue_lines_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_issues" ADD CONSTRAINT "input_issues_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_issues" ADD CONSTRAINT "input_issues_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_issues" ADD CONSTRAINT "input_issues_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_items" ADD CONSTRAINT "input_items_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_prices" ADD CONSTRAINT "input_prices_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_prices" ADD CONSTRAINT "input_prices_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_prices" ADD CONSTRAINT "input_prices_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_ledger_entries" ADD CONSTRAINT "member_ledger_entries_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_ledger_entries" ADD CONSTRAINT "member_ledger_entries_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_ledger_entries" ADD CONSTRAINT "member_ledger_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_ledger_entries" ADD CONSTRAINT "member_ledger_entries_reversal_of_id_member_ledger_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."member_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_batch_id_payment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_deduction_rule_id_deduction_rules_id_fk" FOREIGN KEY ("deduction_rule_id") REFERENCES "public"."deduction_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_input_issue_id_input_issues_id_fk" FOREIGN KEY ("input_issue_id") REFERENCES "public"."input_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_union_id_unions_id_fk" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amcos_union_id_index" ON "amcos" USING btree ("union_id");--> statement-breakpoint
CREATE INDEX "audit_logs_amcos_id_created_at_index" ON "audit_logs" USING btree ("amcos_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_entity_id_index" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_created_at_index" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bales_amcos_id_bale_no_index" ON "bales" USING btree ("amcos_id","bale_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bales_amcos_id_client_ref_index" ON "bales" USING btree ("amcos_id","client_ref");--> statement-breakpoint
CREATE INDEX "bales_market_id_index" ON "bales" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "bales_amcos_id_member_id_index" ON "bales" USING btree ("amcos_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deduction_rules_amcos_id_season_id_code_index" ON "deduction_rules" USING btree ("amcos_id","season_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_season_id_member_id_index" ON "estimates" USING btree ("season_id","member_id");--> statement-breakpoint
CREATE INDEX "estimates_amcos_id_season_id_index" ON "estimates" USING btree ("amcos_id","season_id");--> statement-breakpoint
CREATE INDEX "farms_amcos_id_member_id_index" ON "farms" USING btree ("amcos_id","member_id");--> statement-breakpoint
CREATE INDEX "input_issue_lines_input_issue_id_index" ON "input_issue_lines" USING btree ("input_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "input_issues_amcos_id_issue_no_index" ON "input_issues" USING btree ("amcos_id","issue_no");--> statement-breakpoint
CREATE UNIQUE INDEX "input_issues_amcos_id_client_ref_index" ON "input_issues" USING btree ("amcos_id","client_ref");--> statement-breakpoint
CREATE INDEX "input_issues_amcos_id_season_id_member_id_index" ON "input_issues" USING btree ("amcos_id","season_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "input_items_amcos_id_name_index" ON "input_items" USING btree ("amcos_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "input_prices_season_id_input_item_id_index" ON "input_prices" USING btree ("season_id","input_item_id");--> statement-breakpoint
CREATE INDEX "input_prices_amcos_id_season_id_index" ON "input_prices" USING btree ("amcos_id","season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_amcos_id_market_no_index" ON "markets" USING btree ("amcos_id","market_no");--> statement-breakpoint
CREATE INDEX "member_ledger_entries_amcos_id_member_id_created_at_index" ON "member_ledger_entries" USING btree ("amcos_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_ledger_entries_amcos_id_season_id_index" ON "member_ledger_entries" USING btree ("amcos_id","season_id");--> statement-breakpoint
CREATE INDEX "member_ledger_entries_reference_type_reference_id_index" ON "member_ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_amcos_id_member_no_index" ON "members" USING btree ("amcos_id","member_no");--> statement-breakpoint
CREATE UNIQUE INDEX "members_amcos_id_nida_number_index" ON "members" USING btree ("amcos_id","nida_number");--> statement-breakpoint
CREATE INDEX "members_amcos_id_last_name_index" ON "members" USING btree ("amcos_id","last_name");--> statement-breakpoint
CREATE INDEX "members_amcos_id_phone_index" ON "members" USING btree ("amcos_id","phone");--> statement-breakpoint
CREATE INDEX "members_amcos_id_status_index" ON "members" USING btree ("amcos_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_batches_amcos_id_batch_no_index" ON "payment_batches" USING btree ("amcos_id","batch_no");--> statement-breakpoint
CREATE INDEX "payments_amcos_id_member_id_index" ON "payments" USING btree ("amcos_id","member_id");--> statement-breakpoint
CREATE INDEX "payments_batch_id_index" ON "payments" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "settlement_lines_settlement_id_index" ON "settlement_lines" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_amcos_id_settlement_no_index" ON "settlements" USING btree ("amcos_id","settlement_no");--> statement-breakpoint
CREATE INDEX "settlements_amcos_id_season_id_member_id_index" ON "settlements" USING btree ("amcos_id","season_id","member_id");--> statement-breakpoint
CREATE INDEX "sms_logs_amcos_id_created_at_index" ON "sms_logs" USING btree ("amcos_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_amcos_id_season_id_input_item_id_index" ON "stock_movements" USING btree ("amcos_id","season_id","input_item_id");--> statement-breakpoint
CREATE INDEX "users_amcos_id_index" ON "users" USING btree ("amcos_id");--> statement-breakpoint
CREATE INDEX "users_union_id_index" ON "users" USING btree ("union_id");
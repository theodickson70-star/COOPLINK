CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('MEMBER_REGISTRATION', 'EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT', 'PURCHASE', 'STOCK_ADJUSTMENT', 'INPUT_ISSUE', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."finance_account_kind" AS ENUM('CASH', 'BANK', 'MOBILE_MONEY');--> statement-breakpoint
CREATE TYPE "public"."finance_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."finance_txn_kind" AS ENUM('INCOME', 'EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."finance_txn_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."input_issue_status" ADD VALUE 'PENDING_APPROVAL';--> statement-breakpoint
ALTER TYPE "public"."input_issue_status" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'REPAYMENT';--> statement-breakpoint
ALTER TYPE "public"."member_status" ADD VALUE 'PENDING';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'DAMAGE';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'EXPIRY';--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"request_no" text NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(18, 2),
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb,
	"reason" text,
	"requested_by_id" uuid NOT NULL,
	"requested_role" text NOT NULL,
	"decided_by_id" uuid,
	"decided_role" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "finance_account_kind" NOT NULL,
	"bank_name" text,
	"account_number" text,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid,
	"txn_no" text NOT NULL,
	"kind" "finance_txn_kind" NOT NULL,
	"direction" "finance_direction" NOT NULL,
	"category" text NOT NULL,
	"account_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"txn_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"payee" text,
	"member_id" uuid,
	"supplier_id" uuid,
	"purchase_request_id" uuid,
	"status" "finance_txn_status" NOT NULL,
	"approval_id" uuid,
	"reversal_of_id" uuid,
	"created_by_id" uuid NOT NULL,
	"posted_by_id" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_transactions_reversalOfId_unique" UNIQUE("reversal_of_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"quantity" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"received_qty" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"pr_no" text NOT NULL,
	"supplier_id" uuid,
	"status" "purchase_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"needed_by" date,
	"notes" text,
	"approval_id" uuid,
	"requested_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"tin" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "input_items" ADD COLUMN "reorder_level" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_request_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_reversal_of_id_finance_transactions_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_amcos_id_request_no_index" ON "approval_requests" USING btree ("amcos_id","request_no");--> statement-breakpoint
CREATE INDEX "approval_requests_amcos_id_status_created_at_index" ON "approval_requests" USING btree ("amcos_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_type_entity_id_index" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_amcos_id_name_index" ON "finance_accounts" USING btree ("amcos_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budgets_amcos_id_season_id_category_index" ON "finance_budgets" USING btree ("amcos_id","season_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transactions_amcos_id_txn_no_index" ON "finance_transactions" USING btree ("amcos_id","txn_no");--> statement-breakpoint
CREATE INDEX "finance_transactions_amcos_id_status_txn_date_index" ON "finance_transactions" USING btree ("amcos_id","status","txn_date");--> statement-breakpoint
CREATE INDEX "finance_transactions_amcos_id_account_id_index" ON "finance_transactions" USING btree ("amcos_id","account_id");--> statement-breakpoint
CREATE INDEX "finance_transactions_purchase_request_id_index" ON "finance_transactions" USING btree ("purchase_request_id");--> statement-breakpoint
CREATE INDEX "purchase_request_lines_purchase_request_id_index" ON "purchase_request_lines" USING btree ("purchase_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requests_amcos_id_pr_no_index" ON "purchase_requests" USING btree ("amcos_id","pr_no");--> statement-breakpoint
CREATE INDEX "purchase_requests_amcos_id_status_index" ON "purchase_requests" USING btree ("amcos_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_amcos_id_name_index" ON "suppliers" USING btree ("amcos_id","name");--> statement-breakpoint
CREATE INDEX "stock_movements_amcos_id_expiry_date_index" ON "stock_movements" USING btree ("amcos_id","expiry_date");--> statement-breakpoint
-- Kila AMCOS: mtumishi MMOJA hai kwa kila cheo (Meneja, Mhasibu, Stokipa).
-- Wa ziada wanazimwa (HAWAFUTWI): anabaki aliyeingia karibuni zaidi. Kila uzimaji unaandikwa kwenye audit log.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY amcos_id, role ORDER BY last_login_at DESC NULLS LAST, created_at DESC) AS rn
  FROM users
  WHERE is_active AND amcos_id IS NOT NULL AND role IN ('AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK')
), off AS (
  UPDATE users u SET is_active = false, token_version = u.token_version + 1, updated_at = now()
  FROM ranked r WHERE u.id = r.id AND r.rn > 1
  RETURNING u.id, u.amcos_id, u.role
)
INSERT INTO audit_logs (amcos_id, user_role, action, entity, entity_id, before, after)
SELECT amcos_id, 'SYSTEM', 'STAFF_AUTO_DEACTIVATE', 'User', id::text,
  jsonb_build_object('isActive', true, 'role', role),
  jsonb_build_object('isActive', false, 'reason', 'v0.3.0: mtumishi mmoja kwa kila cheo ndani ya AMCOS')
FROM off;
--> statement-breakpoint
-- Watazamaji (AMCOS_VIEWER) si kati ya watumishi watatu: wanazimwa (hawafutwi)
WITH off AS (
  UPDATE users SET is_active = false, token_version = token_version + 1, updated_at = now()
  WHERE is_active AND role = 'AMCOS_VIEWER'
  RETURNING id, amcos_id, role
)
INSERT INTO audit_logs (amcos_id, user_role, action, entity, entity_id, before, after)
SELECT amcos_id, 'SYSTEM', 'STAFF_AUTO_DEACTIVATE', 'User', id::text,
  jsonb_build_object('isActive', true, 'role', role),
  jsonb_build_object('isActive', false, 'reason', 'v0.3.0: AMCOS ina watumishi watatu tu')
FROM off;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_staff_per_role" ON "users" USING btree ("amcos_id","role") WHERE is_active and role in ('AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK');
--> statement-breakpoint
-- Uamuzi wa idhini haubadilishwi wala kufutwa
CREATE OR REPLACE FUNCTION approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_requests: ombi haliwezi kufutwa';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval_requests: uamuzi umeshafanyika, hauwezi kubadilishwa';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approval_requests_guard
  BEFORE UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_guard();
--> statement-breakpoint
-- Miamala ya fedha haifutwi; iliyokamilika (POSTED) au iliyokataliwa haibadilishwi — inasahihishwa kwa REVERSAL
CREATE OR REPLACE FUNCTION finance_txn_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_transactions: muamala hauwezi kufutwa';
  END IF;
  IF OLD.status IN ('POSTED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'finance_transactions: muamala uliokamilika hauwezi kubadilishwa (tumia REVERSAL)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_transactions_guard
  BEFORE UPDATE OR DELETE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION finance_txn_guard();

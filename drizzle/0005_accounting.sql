CREATE TYPE "public"."asset_status" AS ENUM('ACTIVE', 'DISPOSAL_PENDING', 'DISPOSED');--> statement-breakpoint
CREATE TYPE "public"."gl_account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'JOURNAL';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'TOBACCO_SALE';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'PAYMENT_BATCH';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'TRANSFER';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'PAYROLL';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'ASSET_DISPOSAL';--> statement-breakpoint
ALTER TYPE "public"."finance_txn_kind" ADD VALUE IF NOT EXISTS 'TRANSFER';--> statement-breakpoint
CREATE TABLE "bank_reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"finance_txn_id" uuid NOT NULL,
	CONSTRAINT "bank_reconciliation_items_financeTxnId_unique" UNIQUE("finance_txn_id")
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"statement_balance" numeric(18, 2) NOT NULL,
	"book_balance" numeric(18, 2) NOT NULL,
	"cleared_balance" numeric(18, 2) NOT NULL,
	"uncleared_in" numeric(18, 2) NOT NULL,
	"uncleared_out" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depreciation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"period" text NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"position" text NOT NULL,
	"phone" text,
	"basic_salary" numeric(18, 2) NOT NULL,
	"allowances" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"nssf_no" text,
	"tin" text,
	"payment_method" "payment_method" DEFAULT 'BANK' NOT NULL,
	"bank_name" text,
	"account_number" text,
	"start_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"asset_no" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"residual_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"useful_life_months" integer NOT NULL,
	"location" text,
	"serial_no" text,
	"funding_txn_id" uuid,
	"status" "asset_status" DEFAULT 'ACTIVE' NOT NULL,
	"disposed_at" date,
	"disposal_note" text,
	"disposal_approval_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "gl_account_type" NOT NULL,
	"subtype" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"finance_account_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_accounts_financeAccountId_unique" UNIQUE("finance_account_id")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"entry_no" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"reference" text,
	"approval_id" uuid,
	"reversal_of_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_reversalOfId_unique" UNIQUE("reversal_of_id")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"amcos_id" uuid NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"memo" text,
	"member_id" uuid,
	"supplier_id" uuid,
	"line_no" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"basic_salary" numeric(18, 2) NOT NULL,
	"allowances" numeric(18, 2) NOT NULL,
	"gross" numeric(18, 2) NOT NULL,
	"nssf_employee" numeric(18, 2) NOT NULL,
	"taxable" numeric(18, 2) NOT NULL,
	"paye" numeric(18, 2) NOT NULL,
	"other_deductions" numeric(18, 2) NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	"nssf_employer" numeric(18, 2) NOT NULL,
	"wcf" numeric(18, 2) NOT NULL,
	"sdl" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"run_no" text NOT NULL,
	"period" text NOT NULL,
	"status" "payroll_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"total_gross" numeric(18, 2) NOT NULL,
	"total_paye" numeric(18, 2) NOT NULL,
	"total_nssf_employee" numeric(18, 2) NOT NULL,
	"total_nssf_employer" numeric(18, 2) NOT NULL,
	"total_wcf" numeric(18, 2) NOT NULL,
	"total_sdl" numeric(18, 2) NOT NULL,
	"total_other_deductions" numeric(18, 2) NOT NULL,
	"total_net" numeric(18, 2) NOT NULL,
	"approval_id" uuid,
	"paid_txn_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deduction_rules" ADD COLUMN "gl_account_code" text;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "contra_gl_account_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "transfer_group_id" uuid;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "buyer_name" text;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "exchange_rate" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_batches" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "finance_txn_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_reconciliation_id_bank_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."bank_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_finance_txn_id_finance_transactions_id_fk" FOREIGN KEY ("finance_txn_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_run_id_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_journal_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_reconciliations_amcos_id_account_id_statement_date_index" ON "bank_reconciliations" USING btree ("amcos_id","account_id","statement_date");--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_lines_run_id_asset_id_index" ON "depreciation_lines" USING btree ("run_id","asset_id");--> statement-breakpoint
CREATE INDEX "depreciation_lines_asset_id_index" ON "depreciation_lines" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_runs_amcos_id_period_index" ON "depreciation_runs" USING btree ("amcos_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_amcos_id_employee_no_index" ON "employees" USING btree ("amcos_id","employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_amcos_id_asset_no_index" ON "fixed_assets" USING btree ("amcos_id","asset_no");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_amcos_id_code_index" ON "gl_accounts" USING btree ("amcos_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_amcos_id_entry_no_index" ON "journal_entries" USING btree ("amcos_id","entry_no");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_amcos_id_source_source_id_index" ON "journal_entries" USING btree ("amcos_id","source","source_id");--> statement-breakpoint
CREATE INDEX "journal_entries_amcos_id_entry_date_index" ON "journal_entries" USING btree ("amcos_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_journal_entry_id_index" ON "journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_amcos_id_gl_account_id_index" ON "journal_lines" USING btree ("amcos_id","gl_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_payroll_run_id_employee_id_index" ON "payroll_lines" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_amcos_id_run_no_index" ON "payroll_runs" USING btree ("amcos_id","run_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_per_period" ON "payroll_runs" USING btree ("amcos_id","period") WHERE status in ('PENDING_APPROVAL', 'APPROVED', 'PAID');--> statement-breakpoint
-- Daftari kuu: journal haibadilishwi wala kufutwa (inasahihishwa kwa journal ya kinyume)
CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER depreciation_runs_immutable
  BEFORE UPDATE OR DELETE ON depreciation_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER depreciation_lines_immutable
  BEFORE UPDATE OR DELETE ON depreciation_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER bank_reconciliations_immutable
  BEFORE UPDATE OR DELETE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_items_immutable
  BEFORE UPDATE OR DELETE ON bank_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_one_side CHECK (
  debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
--> statement-breakpoint
-- Kila journal LAZIMA iwe na debit = credit na mistari 2+ (inakaguliwa transaction inapokamilika)
CREATE OR REPLACE FUNCTION journal_balance_check() RETURNS trigger AS $$
DECLARE
  d numeric; c numeric; n integer; eid uuid;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    eid := NEW.id;
  ELSE
    eid := NEW.journal_entry_id;
  END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM journal_lines WHERE journal_entry_id = eid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'journal %: debit (%) na credit (%) hazilingani au mistari haitoshi', eid, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_balance_check();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_balance_check();

CREATE TYPE "public"."amcos_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."announcement_kind" AS ENUM('ANNOUNCEMENT', 'SYSTEM_UPDATE', 'EXPIRY_REMINDER', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('TRIAL', 'MONTHLY', 'ANNUAL');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('SERVER', 'SMS', 'SALARY', 'MARKETING', 'OFFICE', 'TRANSPORT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."platform_payment_category" AS ENUM('SUBSCRIPTION', 'SETUP', 'TRAINING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."platform_payment_status" AS ENUM('PENDING', 'VERIFIED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."restore_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'FINANCE_MANAGER';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'TECH_SUPPORT';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'CUSTOMER_SUPPORT';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'MARKETING_MANAGER';--> statement-breakpoint
CREATE TABLE "announcement_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"amcos_id" uuid,
	"channel" text NOT NULL,
	"recipient" text,
	"status" "delivery_status" DEFAULT 'QUEUED' NOT NULL,
	"provider_ref" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "announcement_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text NOT NULL,
	"amcos_ids" uuid[],
	"channels" text[] NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "backup_status" NOT NULL,
	"size_bytes" integer,
	"location" text,
	"notes" text,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"target_value" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone" text,
	"success" boolean NOT NULL,
	"reason" text,
	"suspicious" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"spent_at" date NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_no" text NOT NULL,
	"amcos_id" uuid,
	"subscription_id" uuid,
	"category" "platform_payment_category" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" "currency" DEFAULT 'TZS' NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider_ref" text,
	"periods" integer DEFAULT 1 NOT NULL,
	"cycle" "billing_cycle",
	"status" "platform_payment_status" DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"failure_reason" text,
	"refunded_at" timestamp with time zone,
	"refund_reason" text,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_payments_invoiceNo_unique" UNIQUE("invoice_no"),
	CONSTRAINT "platform_payments_providerRef_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_id" uuid,
	"reason" text NOT NULL,
	"status" "restore_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"monthly_price" numeric(18, 2) NOT NULL,
	"annual_price" numeric(18, 2) NOT NULL,
	"currency" "currency" DEFAULT 'TZS' NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"grace_days" integer DEFAULT 7 NOT NULL,
	"max_members" integer,
	"features" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"cycle" "billing_cycle" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"grace_days" integer NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" text,
	"path" text,
	"status" integer,
	"message" text,
	"stack" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "status" "amcos_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "registered_by_id" uuid;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_role" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_requests" ADD CONSTRAINT "restore_requests_backup_id_backup_records_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backup_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_deliveries_announcement_id_index" ON "announcement_deliveries" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_deliveries_amcos_id_index" ON "announcement_deliveries" USING btree ("amcos_id");--> statement-breakpoint
CREATE INDEX "announcements_created_at_index" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backup_records_taken_at_index" ON "backup_records" USING btree ("taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_targets_period_metric_index" ON "business_targets" USING btree ("period","metric");--> statement-breakpoint
CREATE INDEX "job_runs_name_started_at_index" ON "job_runs" USING btree ("name","started_at");--> statement-breakpoint
CREATE INDEX "login_events_user_id_created_at_index" ON "login_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_events_created_at_index" ON "login_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_events_phone_created_at_index" ON "login_events" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "platform_expenses_spent_at_index" ON "platform_expenses" USING btree ("spent_at");--> statement-breakpoint
CREATE INDEX "platform_payments_amcos_id_index" ON "platform_payments" USING btree ("amcos_id");--> statement-breakpoint
CREATE INDEX "platform_payments_status_paid_at_index" ON "platform_payments" USING btree ("status","paid_at");--> statement-breakpoint
CREATE INDEX "subscriptions_amcos_id_index" ON "subscriptions" USING btree ("amcos_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_end_date_index" ON "subscriptions" USING btree ("status","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_current" ON "subscriptions" USING btree ("amcos_id") WHERE status in ('TRIAL', 'ACTIVE', 'PAST_DUE');--> statement-breakpoint
CREATE INDEX "system_errors_created_at_index" ON "system_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_revoked_at_index" ON "user_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "amcos_status_index" ON "amcos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_role_index" ON "users" USING btree ("role");--> statement-breakpoint
-- Vyama vilivyokuwa vimezimwa vipate hali SUSPENDED (vingine vyote vinabaki ACTIVE)
UPDATE "amcos" SET "status" = 'SUSPENDED', "status_reason" = 'Kilizimwa kabla ya v0.2.0' WHERE "is_active" = false;
--> statement-breakpoint
-- Namba za ankara za CoopLink (CL-INV-000001 ...)
CREATE SEQUENCE IF NOT EXISTS "platform_invoice_seq";
--> statement-breakpoint
-- Historia ya kuingia haibadilishwi wala kufutwa (kama audit_logs)
CREATE TRIGGER login_events_immutable
  BEFORE UPDATE OR DELETE ON login_events
  FOR EACH ROW EXECUTE FUNCTION prevent_change();

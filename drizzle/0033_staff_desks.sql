CREATE TYPE "public"."expense_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_kind" AS ENUM('NOTE', 'CALL', 'SMS', 'MEETING', 'STAGE', 'ASSIGN');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('WEBSITE', 'PHONE', 'REFERRAL', 'FIELD_VISIT', 'EVENT', 'SOCIAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_DONE', 'NEGOTIATION', 'WON', 'LOST');--> statement-breakpoint
CREATE TABLE "amcos_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "lead_activity_kind" NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "stage" "lead_stage" DEFAULT 'NEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "source" "lead_source" DEFAULT 'WEBSITE' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "members" integer;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "assigned_to_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "next_follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "amcos_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "status" "expense_status" DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "method" "payment_method";--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_expenses" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "amcos_notes" ADD CONSTRAINT "amcos_notes_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_demo_requests_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."demo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amcos_notes_amcos_id_created_at_index" ON "amcos_notes" USING btree ("amcos_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_id_created_at_index" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_budgets_period_category_index" ON "platform_budgets" USING btree ("period","category");--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_requests_stage_index" ON "demo_requests" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "demo_requests_assigned_to_id_index" ON "demo_requests" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "platform_expenses_status_index" ON "platform_expenses" USING btree ("status");--> statement-breakpoint
-- Leads za zamani: hatua inatokana na hali yao ya awali (status haibadilishwi)
UPDATE "demo_requests" SET "stage" = CASE "status" WHEN 'CONTACTED' THEN 'CONTACTED'::lead_stage WHEN 'CLOSED' THEN 'LOST'::lead_stage ELSE 'NEW'::lead_stage END,
  "lost_reason" = CASE WHEN "status" = 'CLOSED' THEN 'Ilifungwa kabla ya CRM' ELSE NULL END,
  "updated_at" = COALESCE("handled_at", "created_at");

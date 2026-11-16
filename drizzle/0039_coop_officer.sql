ALTER TYPE "public"."role" ADD VALUE 'COOP_OFFICER' BEFORE 'FINANCE_MANAGER';--> statement-breakpoint
CREATE TABLE "oversight_directives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"dir_no" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'SENT' NOT NULL,
	"issued_by_id" uuid NOT NULL,
	"ack_by_id" uuid,
	"ack_at" timestamp with time zone,
	"compliance_note" text,
	"complied_by_id" uuid,
	"complied_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"close_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oversight_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"amcos_id" uuid NOT NULL,
	"finding_no" integer NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"severity" text NOT NULL,
	"recommendation" text,
	"due_date" date,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"response" text,
	"responded_by_id" uuid,
	"responded_at" timestamp with time zone,
	"resolution_note" text,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oversight_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"insp_no" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"summary" text,
	"conclusion" text,
	"created_by_id" uuid NOT NULL,
	"issued_at" timestamp with time zone,
	"issued_by_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by_id" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_by_id" uuid,
	"lifted_at" timestamp with time zone,
	"lift_reason" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "jurisdiction_region" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "jurisdiction_district" text;--> statement-breakpoint
ALTER TABLE "oversight_directives" ADD CONSTRAINT "oversight_directives_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversight_findings" ADD CONSTRAINT "oversight_findings_inspection_id_oversight_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."oversight_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversight_findings" ADD CONSTRAINT "oversight_findings_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oversight_inspections" ADD CONSTRAINT "oversight_inspections_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oversight_directives_amcos_id_dir_no_index" ON "oversight_directives" USING btree ("amcos_id","dir_no");--> statement-breakpoint
CREATE INDEX "oversight_directives_status_index" ON "oversight_directives" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "oversight_findings_inspection_id_finding_no_index" ON "oversight_findings" USING btree ("inspection_id","finding_no");--> statement-breakpoint
CREATE INDEX "oversight_findings_amcos_id_status_index" ON "oversight_findings" USING btree ("amcos_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "oversight_inspections_amcos_id_insp_no_index" ON "oversight_inspections" USING btree ("amcos_id","insp_no");--> statement-breakpoint
CREATE INDEX "oversight_inspections_status_index" ON "oversight_inspections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_holds_active_unique" ON "payment_holds" USING btree ("amcos_id") WHERE lifted_at is null;
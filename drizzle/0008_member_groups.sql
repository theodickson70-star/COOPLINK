CREATE TYPE "public"."group_status" AS ENUM('PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE');--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'GROUP_REGISTRATION';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'GROUP_CHANGE';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE IF NOT EXISTS 'GROUP_GUARANTEE';--> statement-breakpoint
CREATE TABLE "member_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"added_by_id" uuid,
	"removed_by_id" uuid,
	"remove_reason" text
);
--> statement-breakpoint
CREATE TABLE "member_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"group_no" text NOT NULL,
	"name" text NOT NULL,
	"village" text,
	"leader_member_id" uuid,
	"status" "group_status" DEFAULT 'PENDING' NOT NULL,
	"approval_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD COLUMN "kind" text DEFAULT 'RULE' NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD COLUMN "beneficiary_member_id" uuid;--> statement-breakpoint
ALTER TABLE "member_group_members" ADD CONSTRAINT "member_group_members_group_id_member_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."member_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group_members" ADD CONSTRAINT "member_group_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_groups" ADD CONSTRAINT "member_groups_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_group_members_group_id_index" ON "member_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_one_active_group" ON "member_group_members" USING btree ("member_id") WHERE left_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_groups_amcos_id_group_no_index" ON "member_groups" USING btree ("amcos_id","group_no");--> statement-breakpoint
CREATE UNIQUE INDEX "member_groups_amcos_id_name_index" ON "member_groups" USING btree ("amcos_id","name");
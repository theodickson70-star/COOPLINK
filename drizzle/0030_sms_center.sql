ALTER TYPE "public"."sms_status" ADD VALUE IF NOT EXISTS 'SKIPPED';--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"amcos_id" uuid,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"audience" jsonb NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"segments" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_devices_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "handed_over_by_id" uuid;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "handover_method" text;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "handover_phone" text;--> statement-breakpoint
ALTER TABLE "input_issues" ADD COLUMN "handover_note" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "segments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "reference_type" text;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_broadcasts" ADD CONSTRAINT "sms_broadcasts_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_codes_purpose_subject_id_created_at_index" ON "otp_codes" USING btree ("purpose","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_broadcasts_amcos_id_created_at_index" ON "sms_broadcasts" USING btree ("amcos_id","created_at");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_id_index" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sms_logs_status_created_at_index" ON "sms_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sms_logs_kind_created_at_index" ON "sms_logs" USING btree ("kind","created_at");
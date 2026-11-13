CREATE TYPE "public"."internal_request_category" AS ENUM('ACCOUNT_SIGNOUT', 'FEE_WAIVER', 'REFUND', 'AMCOS_APPROVAL', 'TECHNICAL', 'ACCESS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."internal_request_status" AS ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'DECLINED');--> statement-breakpoint
CREATE TABLE "internal_request_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_no" integer GENERATED ALWAYS AS IDENTITY (sequence name "internal_requests_request_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 101 CACHE 1),
	"created_by_id" uuid NOT NULL,
	"category" "internal_request_category" NOT NULL,
	"priority" "ticket_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "internal_request_status" DEFAULT 'OPEN' NOT NULL,
	"subject" text NOT NULL,
	"amcos_id" uuid,
	"target_user_id" uuid,
	"resolution" text,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"creator_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_request_messages" ADD CONSTRAINT "internal_request_messages_request_id_internal_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."internal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_request_messages" ADD CONSTRAINT "internal_request_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_request_messages_request_id_created_at_index" ON "internal_request_messages" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "internal_requests_status_created_at_index" ON "internal_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "internal_requests_created_by_id_index" ON "internal_requests" USING btree ("created_by_id");--> statement-breakpoint
-- 2FA ni lazima kwa wafanyakazi wa CoopLink; muda wa kuwasha (siku 3) unaanza tangu toleo hili (au tangu akaunti iundwe)
INSERT INTO "platform_settings" ("key", "value") VALUES ('security', jsonb_build_object('staff2fa', true, 'staff2faSince', now(), 'graceDays', 3)) ON CONFLICT ("key") DO NOTHING;

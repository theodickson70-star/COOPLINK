CREATE TABLE "system_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"auto_resolved" boolean DEFAULT false NOT NULL,
	"ack_at" timestamp with time zone,
	"ack_by_id" uuid,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_uptime" (
	"bucket" timestamp with time zone PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"db_ms" integer,
	"version" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_errors" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_errors" ADD COLUMN "resolved_by_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "system_alerts_open_key" ON "system_alerts" USING btree ("key") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "system_alerts_last_at_index" ON "system_alerts" USING btree ("last_at");
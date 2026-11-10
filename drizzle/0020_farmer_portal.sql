ALTER TABLE "amcos" ADD COLUMN "farmer_portal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_pin_hash" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_must_change" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_pin_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_pin_issued_by_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "portal_last_login_at" timestamp with time zone;
ALTER TABLE "members" ADD COLUMN "phone_owner_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "name_override_reason" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "name_override_by_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "name_override_at" timestamp with time zone;
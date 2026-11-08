CREATE TABLE "member_photos" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"data" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "voter_id_number" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "entry_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "entry_fee_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "entry_fee_paid_at" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "entry_fee_reference" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "guarantor_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "guarantor_phone" text;--> statement-breakpoint
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_amcos_id_voter_id_number_index" ON "members" USING btree ("amcos_id","voter_id_number");
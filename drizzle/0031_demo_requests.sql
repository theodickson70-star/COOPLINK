CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"amcos_name" text NOT NULL,
	"region" text,
	"message" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"note" text,
	"ip" text,
	"handled_by_id" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_requests_status_created_at_index" ON "demo_requests" USING btree ("status","created_at");
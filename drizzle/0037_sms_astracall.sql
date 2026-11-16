ALTER TABLE "sms_logs" ADD COLUMN "sender_id" text;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sms_logs_provider_ref_index" ON "sms_logs" USING btree ("provider_ref");
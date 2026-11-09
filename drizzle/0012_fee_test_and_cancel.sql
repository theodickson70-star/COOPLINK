ALTER TABLE "platform_fees" ADD COLUMN "test_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "platform_mobile_payments" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_mobile_payments" ADD COLUMN "abandoned_at" timestamp with time zone;
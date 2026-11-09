CREATE TYPE "public"."mobile_payment_status" AS ENUM('SENDING', 'PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "platform_mobile_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_id" uuid NOT NULL,
	"amcos_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"amount_minor" text NOT NULL,
	"phone" text NOT NULL,
	"payer_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"teepay_id" text,
	"reference" text,
	"status" "mobile_payment_status" DEFAULT 'SENDING' NOT NULL,
	"status_detail" text,
	"channel" text,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"platform_payment_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_mobile_payments_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "platform_mobile_payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "platform_mobile_payments" ADD CONSTRAINT "platform_mobile_payments_fee_id_platform_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."platform_fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mobile_payments" ADD CONSTRAINT "platform_mobile_payments_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_mobile_payments_fee_id_index" ON "platform_mobile_payments" USING btree ("fee_id");--> statement-breakpoint
CREATE INDEX "platform_mobile_payments_status_index" ON "platform_mobile_payments" USING btree ("status");
CREATE TYPE "public"."control_number_status" AS ENUM('ISSUING', 'ISSUED', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."platform_fee_kind" AS ENUM('ENTRANCE', 'SEASON');--> statement-breakpoint
CREATE TYPE "public"."platform_fee_status" AS ENUM('UNPAID', 'PARTIAL', 'PAID', 'WAIVED');--> statement-breakpoint
CREATE TABLE "platform_control_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_id" uuid NOT NULL,
	"amcos_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"amount_minor" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"teepay_id" text,
	"number" text,
	"status" "control_number_status" DEFAULT 'ISSUING' NOT NULL,
	"collected_minor" text DEFAULT '0' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_control_numbers_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "platform_control_numbers_teepayId_unique" UNIQUE("teepay_id")
);
--> statement-breakpoint
CREATE TABLE "platform_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"kind" "platform_fee_kind" NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"due_date" date NOT NULL,
	"status" "platform_fee_status" DEFAULT 'UNPAID' NOT NULL,
	"paid_at" timestamp with time zone,
	"waived_by_id" uuid,
	"waived_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teepay_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_payments" ADD COLUMN "fee_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD COLUMN "control_number_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_control_numbers" ADD CONSTRAINT "platform_control_numbers_fee_id_platform_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."platform_fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_control_numbers" ADD CONSTRAINT "platform_control_numbers_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_control_numbers_fee_id_index" ON "platform_control_numbers" USING btree ("fee_id");--> statement-breakpoint
CREATE INDEX "platform_control_numbers_status_index" ON "platform_control_numbers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_fees_amcos_id_status_index" ON "platform_fees" USING btree ("amcos_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_fees_one_entrance" ON "platform_fees" USING btree ("amcos_id") WHERE kind = 'ENTRANCE';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_fees_one_season" ON "platform_fees" USING btree ("amcos_id","due_date") WHERE kind = 'SEASON';--> statement-breakpoint
CREATE INDEX "platform_payments_fee_id_index" ON "platform_payments" USING btree ("fee_id");
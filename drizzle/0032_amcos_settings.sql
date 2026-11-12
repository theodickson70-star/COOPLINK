ALTER TABLE "amcos" ADD COLUMN "tin" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "reg_date" date;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "leaders" jsonb;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "main_account_id" uuid;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "doc_footer" text;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "doc_show_bank" boolean DEFAULT false NOT NULL;
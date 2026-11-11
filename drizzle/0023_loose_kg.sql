ALTER TABLE "input_issue_lines" ALTER COLUMN "quantity" SET DATA TYPE numeric(16, 4);--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "quantity" SET DATA TYPE numeric(16, 4);--> statement-breakpoint
ALTER TABLE "input_issue_lines" ADD COLUMN "kg" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "input_items" ADD COLUMN "pack_kg" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "input_items" ADD COLUMN "loose_kg" boolean DEFAULT false NOT NULL;
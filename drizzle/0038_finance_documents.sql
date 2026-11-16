CREATE TABLE "finance_doc_prints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"txn_id" uuid NOT NULL,
	"copy_no" integer NOT NULL,
	"printed_by_id" uuid NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_documents" (
	"txn_id" uuid PRIMARY KEY NOT NULL,
	"amcos_id" uuid NOT NULL,
	"verify_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_documents_verifyToken_unique" UNIQUE("verify_token")
);
--> statement-breakpoint
CREATE TABLE "finance_txn_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"txn_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"gl_account_id" uuid,
	"cost_center" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "doc_no" text;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "book_ref" text;--> statement-breakpoint
ALTER TABLE "finance_doc_prints" ADD CONSTRAINT "finance_doc_prints_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_doc_prints" ADD CONSTRAINT "finance_doc_prints_txn_id_finance_transactions_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_txn_id_finance_transactions_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_txn_lines" ADD CONSTRAINT "finance_txn_lines_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_txn_lines" ADD CONSTRAINT "finance_txn_lines_txn_id_finance_transactions_id_fk" FOREIGN KEY ("txn_id") REFERENCES "public"."finance_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_doc_prints_txn_id_copy_no_index" ON "finance_doc_prints" USING btree ("txn_id","copy_no");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_txn_lines_txn_id_line_no_index" ON "finance_txn_lines" USING btree ("txn_id","line_no");--> statement-breakpoint
CREATE INDEX "finance_txn_lines_amcos_id_gl_account_id_index" ON "finance_txn_lines" USING btree ("amcos_id","gl_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transactions_doc_no_unique" ON "finance_transactions" USING btree ("amcos_id","doc_no") WHERE doc_no is not null;
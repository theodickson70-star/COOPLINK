CREATE TABLE "stock_alert_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"status" text NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "stock_alert_states" ADD CONSTRAINT "stock_alert_states_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_states" ADD CONSTRAINT "stock_alert_states_input_item_id_input_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."input_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alert_states_item_unique" ON "stock_alert_states" USING btree ("input_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_amcos_client_ref_unique" ON "members" USING btree ("amcos_id","client_ref");
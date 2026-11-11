CREATE TABLE "grade_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"price_usd" numeric(10, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bales" ADD COLUMN "list_price_usd" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "bales" ADD COLUMN "price_note" text;--> statement-breakpoint
ALTER TABLE "grade_prices" ADD CONSTRAINT "grade_prices_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_prices" ADD CONSTRAINT "grade_prices_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_prices_amcos_id_season_id_grade_index" ON "grade_prices" USING btree ("amcos_id","season_id","grade");
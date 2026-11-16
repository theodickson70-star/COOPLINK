CREATE TABLE "farmer_statement_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"season_id" uuid,
	"token_hash" text NOT NULL,
	"source" text NOT NULL,
	"created_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farmer_statement_links_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "farmer_statement_links" ADD CONSTRAINT "farmer_statement_links_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_statement_links" ADD CONSTRAINT "farmer_statement_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farmer_statement_links" ADD CONSTRAINT "farmer_statement_links_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "farmer_statement_links_member_id_index" ON "farmer_statement_links" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "farmer_statement_links_amcos_id_index" ON "farmer_statement_links" USING btree ("amcos_id");
CREATE TABLE "phone_name_lookups" (
	"phone" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"name" text,
	"network" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);

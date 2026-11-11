CREATE TYPE "public"."marital_status" AS ENUM('MARRIED', 'SINGLE');--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "marital_status" "marital_status";
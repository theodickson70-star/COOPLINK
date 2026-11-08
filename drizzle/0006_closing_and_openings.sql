ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'PERIOD_CLOSE';--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE IF NOT EXISTS 'YEAR_END_CLOSE';--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amcos_id" uuid NOT NULL,
	"locked_through" date NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"approval_id" uuid,
	"journal_entry_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_amcos_id_amcos_id_fk" FOREIGN KEY ("amcos_id") REFERENCES "public"."amcos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_locks_amcos_id_locked_through_index" ON "period_locks" USING btree ("amcos_id","locked_through");--> statement-breakpoint
-- Kufunga kipindi hakutenguliwi: rekodi za vipindi vilivyofungwa hazibadilishwi wala kufutwa
CREATE TRIGGER period_locks_immutable
  BEFORE UPDATE OR DELETE ON period_locks
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION locked_through(a uuid) RETURNS date AS $$
  SELECT max(locked_through) FROM period_locks WHERE amcos_id = a;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
-- Hakuna journal kwenye kipindi kilichofungwa
CREATE OR REPLACE FUNCTION journal_period_guard() RETURNS trigger AS $$
DECLARE l date;
BEGIN
  l := locked_through(NEW.amcos_id);
  IF l IS NOT NULL AND NEW.entry_date <= l THEN
    RAISE EXCEPTION 'Kipindi kimefungwa hadi % — journal ya tarehe % hairuhusiwi', l, NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_entries_period_guard
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_period_guard();
--> statement-breakpoint
-- Hakuna muamala wa fedha unaokamilishwa (POSTED) kwa tarehe ya kipindi kilichofungwa
CREATE OR REPLACE FUNCTION finance_period_guard() RETURNS trigger AS $$
DECLARE l date;
BEGIN
  IF NEW.status = 'POSTED' THEN
    l := locked_through(NEW.amcos_id);
    IF l IS NOT NULL AND NEW.txn_date <= l THEN
      RAISE EXCEPTION 'Kipindi kimefungwa hadi % — muamala wa tarehe % hauruhusiwi', l, NEW.txn_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_transactions_period_guard
  BEFORE INSERT OR UPDATE ON finance_transactions
  FOR EACH ROW EXECUTE FUNCTION finance_period_guard();

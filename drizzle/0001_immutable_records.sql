-- Rekodi za fedha, stoo na ukaguzi HAZIBADILISHWI wala kufutwa.
-- Kosa husahihishwa kwa rekodi mpya (REVERSAL / RETURN / ADJUSTMENT).
-- Hii inalinda uwazi hata kama mtu atapata access ya database moja kwa moja kupitia app.
CREATE OR REPLACE FUNCTION prevent_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % kwenye % hairuhusiwi', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER member_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON member_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER stock_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_change();
--> statement-breakpoint
-- Kila rekodi ya ledger lazima iwe debit AU credit (si zote mbili, si sifuri)
ALTER TABLE member_ledger_entries ADD CONSTRAINT ledger_one_side
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));
--> statement-breakpoint
-- Msimu mmoja tu unaweza kuwa "wa sasa"
CREATE UNIQUE INDEX seasons_one_current ON seasons (is_current) WHERE is_current = true;

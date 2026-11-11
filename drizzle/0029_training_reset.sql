ALTER TABLE "amcos" ADD COLUMN "training" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "training_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "amcos" ADD COLUMN "training_reset_by_id" uuid;--> statement-breakpoint
-- Kinga za rekodi zisizobadilika: kila kitu kinabaki kama zamani ISIPOKUWA ndani ya muamala wa
-- "kufuta data ya mafunzo" wa Owner (set_config('cooplink.training_reset','on', true) — ya muamala huo tu).
CREATE OR REPLACE FUNCTION prevent_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('cooplink.training_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % kwenye % hairuhusiwi', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('cooplink.training_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'approval_requests: ombi haliwezi kufutwa';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval_requests: uamuzi umeshafanyika, hauwezi kubadilishwa';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_txn_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('cooplink.training_reset', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'finance_transactions: muamala hauwezi kufutwa';
  END IF;
  IF OLD.status IN ('POSTED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'finance_transactions: muamala uliokamilika hauwezi kubadilishwa (tumia REVERSAL)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

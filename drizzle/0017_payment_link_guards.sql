-- Provider notifications are evidence: never edited or deleted.
CREATE OR REPLACE FUNCTION payment_link_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_link_events is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_link_events_no_update BEFORE UPDATE OR DELETE ON payment_link_events FOR EACH ROW EXECUTE FUNCTION payment_link_events_append_only();
--> statement-breakpoint
-- A paid link stays paid (its money is real); only settlement fields may change afterwards.
CREATE OR REPLACE FUNCTION payment_links_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'paid payment link % cannot change to %', OLD.id, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.paid_halalas > 0 AND NEW.paid_halalas <> OLD.paid_halalas THEN
    RAISE EXCEPTION 'paid amount of payment link % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_links_guard BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION payment_links_guard();

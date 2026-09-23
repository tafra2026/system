-- Payments: never deleted; amount/order/method/time are immutable; status can only move from
-- pending to confirmed/rejected; a cash payment joins a handover once.
CREATE OR REPLACE FUNCTION pm_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.method <> OLD.method OR NEW.amount_halalas <> OLD.amount_halalas
     OR NEW.received_at <> OLD.received_at OR NEW.is_deposit <> OLD.is_deposit
     OR NEW.cash_holder_employee_id IS DISTINCT FROM OLD.cash_holder_employee_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'payment core fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'only pending payments can change status' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.cash_handover_id IS NOT NULL AND NEW.cash_handover_id IS DISTINCT FROM OLD.cash_handover_id THEN
    RAISE EXCEPTION 'handover already recorded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION pm_payments_guard();
--> statement-breakpoint
-- Commission ledger: append-only; the only allowed change is attaching it to a payroll once.
CREATE OR REPLACE FUNCTION pm_commission_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commission entries are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.payroll_item_id IS NOT NULL OR NEW.amount_halalas <> OLD.amount_halalas OR NEW.employee_id <> OLD.employee_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'commission entries are append-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER commission_entries_guard BEFORE UPDATE OR DELETE ON "commission_entries" FOR EACH ROW EXECUTE FUNCTION pm_commission_guard();
--> statement-breakpoint
CREATE TRIGGER cash_handovers_append_only BEFORE UPDATE OR DELETE ON "cash_handovers" FOR EACH ROW EXECUTE FUNCTION pm_block_modification();

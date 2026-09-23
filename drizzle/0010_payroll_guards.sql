-- Expense categories (manual expenses). Salaries and commissions come from payroll/ledger.
INSERT INTO "expense_categories" ("code", "name_ar", "name_en", "sort_order") VALUES
  ('ads', 'الإعلانات', 'Advertising', 1),
  ('marketing_contract', 'عقد شركة التسويق', 'Marketing agency contract', 2),
  ('supplies', 'الخامات', 'Supplies', 3),
  ('fuel_transport', 'الوقود والنقل', 'Fuel & transport', 4),
  ('subscriptions', 'الاشتراكات', 'Subscriptions', 5),
  ('other', 'أخرى', 'Other', 9)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER advance_repayments_append_only BEFORE UPDATE OR DELETE ON "advance_repayments" FOR EACH ROW EXECUTE FUNCTION pm_block_modification();
--> statement-breakpoint
CREATE TRIGGER payroll_payments_append_only BEFORE UPDATE OR DELETE ON "payroll_payments" FOR EACH ROW EXECUTE FUNCTION pm_block_modification();
--> statement-breakpoint
CREATE TRIGGER payroll_adjustments_append_only BEFORE UPDATE OR DELETE ON "payroll_adjustments" FOR EACH ROW EXECUTE FUNCTION pm_block_modification();
--> statement-breakpoint
CREATE TRIGGER advances_append_only BEFORE UPDATE OR DELETE ON "advances" FOR EACH ROW EXECUTE FUNCTION pm_block_modification();
--> statement-breakpoint
-- Approved/closed payroll items are frozen (draft items can be regenerated).
CREATE OR REPLACE FUNCTION pm_payroll_items_guard() RETURNS trigger AS $$
DECLARE st payroll_status;
BEGIN
  SELECT status INTO st FROM payroll_runs WHERE id = COALESCE(OLD.run_id, NEW.run_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'payroll month is approved; items are frozen' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_items_guard BEFORE UPDATE OR DELETE ON "payroll_items" FOR EACH ROW EXECUTE FUNCTION pm_payroll_items_guard();

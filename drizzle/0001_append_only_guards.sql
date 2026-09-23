-- Append-only guards: audit history and salary history can never be rewritten or deleted.
CREATE OR REPLACE FUNCTION pm_block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION pm_block_modification();
--> statement-breakpoint
CREATE TRIGGER salary_records_append_only BEFORE UPDATE OR DELETE ON "salary_records"
  FOR EACH ROW EXECUTE FUNCTION pm_block_modification();

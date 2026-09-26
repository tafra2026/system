-- Document numbers are never reused.
CREATE SEQUENCE IF NOT EXISTS customer_document_seq START 1;
--> statement-breakpoint
-- An issued document is final: its snapshot and number cannot change or disappear.
CREATE OR REPLACE FUNCTION customer_documents_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'customer_documents is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER customer_documents_no_change BEFORE UPDATE OR DELETE ON customer_documents FOR EACH ROW EXECUTE FUNCTION customer_documents_append_only();

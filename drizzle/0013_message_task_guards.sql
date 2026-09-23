-- A confirmed or cancelled message task is final: it cannot be reopened or edited
-- (spec §13: history of what staff confirmed must not be rewritten).
CREATE OR REPLACE FUNCTION message_tasks_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('sent', 'cancelled') THEN
    RAISE EXCEPTION 'message task % is final (%)', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ready' AND OLD.status <> 'ready' THEN
    RAISE EXCEPTION 'message task % cannot go back to ready', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER message_tasks_guard BEFORE UPDATE ON message_tasks FOR EACH ROW EXECUTE FUNCTION message_tasks_guard();

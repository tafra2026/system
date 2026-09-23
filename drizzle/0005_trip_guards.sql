-- One team per employee per day (effective-dated memberships never overlap).
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);
--> statement-breakpoint
-- A driver cannot drive two legs at once (also under concurrent planning). SQLSTATE 23P01.
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_driver_no_overlap"
  EXCLUDE USING gist ("driver_employee_id" WITH =, tstzrange("depart_at", "arrive_at", '[)') WITH &&)
  WHERE ("blocking");
--> statement-breakpoint
-- Team history is append-only except closing an open membership (effective_to NULL → date).
CREATE OR REPLACE FUNCTION pm_team_members_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'team_members is append-only' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.effective_to IS NOT NULL OR NEW.employee_id <> OLD.employee_id OR NEW.team_id <> OLD.team_id
     OR NEW.effective_from <> OLD.effective_from OR NEW.effective_to IS NULL THEN
    RAISE EXCEPTION 'team_members rows can only be closed once' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER team_members_guard BEFORE UPDATE OR DELETE ON "team_members"
  FOR EACH ROW EXECUTE FUNCTION pm_team_members_guard();

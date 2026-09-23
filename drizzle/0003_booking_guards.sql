-- Specialists cannot be double-booked: overlapping blocking windows for the same employee
-- are rejected by the database itself (also under concurrent bookings). SQLSTATE 23P01.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "visit_specialists" ADD CONSTRAINT "visit_specialists_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("blocking");
--> statement-breakpoint
ALTER TABLE "visit_specialists" ADD CONSTRAINT "visit_specialists_blocking_window"
  CHECK (NOT "blocking" OR ("starts_at" IS NOT NULL AND "ends_at" > "starts_at"));
--> statement-breakpoint
-- Order references: PM-YYMM-NNNN from a global sequence.
CREATE SEQUENCE IF NOT EXISTS order_reference_seq START 1;

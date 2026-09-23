CREATE TYPE "public"."commission_kind" AS ENUM('specialist', 'moderator', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'pos', 'tabby', 'tamara');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "cash_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_employee_id" uuid NOT NULL,
	"received_by_user_id" uuid NOT NULL,
	"expected_halalas" integer NOT NULL,
	"actual_halalas" integer NOT NULL,
	"difference_reason" text,
	"handed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_handovers_amounts" CHECK ("cash_handovers"."expected_halalas" >= 0 AND "cash_handovers"."actual_halalas" >= 0),
	CONSTRAINT "cash_handovers_reason" CHECK ("cash_handovers"."expected_halalas" = "cash_handovers"."actual_halalas" OR length(trim(coalesce("cash_handovers"."difference_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"employee_id" uuid NOT NULL,
	"kind" "commission_kind" NOT NULL,
	"amount_halalas" integer NOT NULL,
	"rules_version" text,
	"reason" text,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payroll_item_id" uuid,
	"created_by_user_id" uuid,
	CONSTRAINT "commission_entries_reason" CHECK ("commission_entries"."kind" <> 'adjustment' OR length(trim(coalesce("commission_entries"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_halalas" integer NOT NULL,
	"status" "payment_status" NOT NULL,
	"is_deposit" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"reference" text,
	"notes" text,
	"cash_holder_employee_id" uuid,
	"cash_handover_id" uuid,
	"idempotency_key" text,
	"recorded_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_halalas" > 0),
	CONSTRAINT "payments_cash_holder" CHECK (("payments"."method" = 'cash') = ("payments"."cash_holder_employee_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_from_employee_id_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_holder_employee_id_employees_id_fk" FOREIGN KEY ("cash_holder_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_handover_id_cash_handovers_id_fk" FOREIGN KEY ("cash_handover_id") REFERENCES "public"."cash_handovers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_entries_employee_idx" ON "commission_entries" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "commission_entries_order_idx" ON "commission_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_uq" ON "payments" USING btree ("idempotency_key");
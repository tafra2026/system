CREATE TYPE "public"."expense_status" AS ENUM('draft', 'approved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."payroll_adjustment_kind" AS ENUM('bonus', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'approved', 'closed');--> statement-breakpoint
CREATE TABLE "advance_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"monthly_installment_halalas" integer NOT NULL,
	"given_on" date NOT NULL,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advances_amounts" CHECK ("advances"."amount_halalas" > 0 AND "advances"."monthly_installment_halalas" > 0 AND "advances"."monthly_installment_halalas" <= "advances"."amount_halalas")
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "expense_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"period_month" text NOT NULL,
	"paid_on" date,
	"description" text NOT NULL,
	"item_name" text,
	"notes" text,
	"status" "expense_status" DEFAULT 'draft' NOT NULL,
	"void_reason" text,
	"recurring_id" uuid,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_halalas" > 0),
	CONSTRAINT "expenses_period_format" CHECK ("expenses"."period_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "expenses_void_reason" CHECK ("expenses"."status" <> 'voided' OR length(trim(coalesce("expenses"."void_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "payroll_adjustment_kind" NOT NULL,
	"amount_halalas" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_adjustments_amount" CHECK ("payroll_adjustments"."amount_halalas" > 0),
	CONSTRAINT "payroll_adjustments_reason" CHECK (length(trim("payroll_adjustments"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"base_salary_halalas" integer NOT NULL,
	"commissions_halalas" integer NOT NULL,
	"bonuses_halalas" integer NOT NULL,
	"deductions_halalas" integer NOT NULL,
	"advance_deduction_halalas" integer NOT NULL,
	"net_halalas" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_item_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payments_amount" CHECK ("payroll_payments"."amount_halalas" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"status" "payroll_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month_format" CHECK ("payroll_runs"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_halalas" integer NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advance_repayments" ADD CONSTRAINT "advance_repayments_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_repayments" ADD CONSTRAINT "advance_repayments_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_period_idx" ON "expenses" USING btree ("period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_period_uq" ON "expenses" USING btree ("recurring_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_items_run_employee_uq" ON "payroll_items" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month_uq" ON "payroll_runs" USING btree ("month");
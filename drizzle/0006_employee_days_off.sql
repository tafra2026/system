CREATE TABLE "employee_days_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"off_date" date NOT NULL,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_weekly_off" (
	"employee_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_weekly_off_weekday" CHECK ("employee_weekly_off"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
ALTER TABLE "employee_days_off" ADD CONSTRAINT "employee_days_off_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_days_off" ADD CONSTRAINT "employee_days_off_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_weekly_off" ADD CONSTRAINT "employee_weekly_off_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_weekly_off" ADD CONSTRAINT "employee_weekly_off_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_days_off_active_uq" ON "employee_days_off" USING btree ("employee_id","off_date") WHERE "employee_days_off"."cancelled_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_weekly_off_uq" ON "employee_weekly_off" USING btree ("employee_id","weekday");
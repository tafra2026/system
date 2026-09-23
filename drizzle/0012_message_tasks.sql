CREATE TYPE "public"."message_kind" AS ENUM('booking_confirmation', 'visit_reminder', 'on_the_way', 'review_request');--> statement-breakpoint
CREATE TYPE "public"."message_task_status" AS ENUM('ready', 'opened', 'sent', 'cancelled');--> statement-breakpoint
CREATE TABLE "message_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "message_kind" NOT NULL,
	"order_id" uuid NOT NULL,
	"visit_id" uuid,
	"dedupe_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "message_task_status" DEFAULT 'ready' NOT NULL,
	"assignee_employee_id" uuid,
	"opened_at" timestamp with time zone,
	"opened_by_user_id" uuid,
	"sent_confirmed_at" timestamp with time zone,
	"sent_confirmed_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_tasks_visit_required" CHECK ("message_tasks"."kind" IN ('booking_confirmation', 'review_request') OR "message_tasks"."visit_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_assignee_employee_id_employees_id_fk" FOREIGN KEY ("assignee_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_sent_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("sent_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_tasks_dedupe_uq" ON "message_tasks" USING btree ("dedupe_key") WHERE "message_tasks"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "message_tasks_status_due_idx" ON "message_tasks" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "message_tasks_order_idx" ON "message_tasks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "message_tasks_assignee_idx" ON "message_tasks" USING btree ("assignee_employee_id");
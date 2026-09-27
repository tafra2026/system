ALTER TABLE "message_tasks" ADD COLUMN "auto_state" text;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD COLUMN "auto_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD COLUMN "auto_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD COLUMN "auto_error" text;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD COLUMN "auto_provider_id" text;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD COLUMN "auto_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_auto_state" CHECK ("message_tasks"."auto_state" IS NULL OR "message_tasks"."auto_state" IN ('sending', 'failed', 'gave_up', 'uncertain', 'sent'));
ALTER TABLE "trip_legs" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD COLUMN "completed_at" timestamp with time zone;
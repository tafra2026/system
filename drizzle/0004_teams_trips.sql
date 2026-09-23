CREATE TYPE "public"."travel_source" AS ENUM('google', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trip_leg_kind" AS ENUM('dropoff', 'pickup');--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_range" CHECK ("team_members"."effective_to" IS NULL OR "team_members"."effective_to" > "team_members"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"kind" "trip_leg_kind" NOT NULL,
	"driver_employee_id" uuid NOT NULL,
	"origin_visit_id" uuid,
	"origin_snapshot" jsonb NOT NULL,
	"travel_minutes" integer NOT NULL,
	"travel_source" "travel_source" NOT NULL,
	"buffer_minutes" integer NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_legs_times" CHECK ("trip_legs"."arrive_at" > "trip_legs"."depart_at"),
	CONSTRAINT "trip_legs_travel" CHECK ("trip_legs"."travel_minutes" BETWEEN 1 AND 300),
	CONSTRAINT "trip_legs_buffer" CHECK ("trip_legs"."buffer_minutes" BETWEEN 10 AND 15)
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_driver_employee_id_employees_id_fk" FOREIGN KEY ("driver_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_origin_visit_id_visits_id_fk" FOREIGN KEY ("origin_visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_legs" ADD CONSTRAINT "trip_legs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_employee_idx" ON "team_members" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_legs_visit_kind_uq" ON "trip_legs" USING btree ("visit_id","kind");--> statement-breakpoint
CREATE INDEX "trip_legs_driver_idx" ON "trip_legs" USING btree ("driver_employee_id");
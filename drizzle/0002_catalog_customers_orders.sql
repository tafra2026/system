CREATE TYPE "public"."order_line_kind" AS ENUM('service', 'package', 'custom');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'completed', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('unscheduled', 'scheduled', 'completed', 'pending_review');--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"district" text NOT NULL,
	"address_line" text,
	"building_details" text,
	"access_instructions" text,
	"latitude" double precision,
	"longitude" double precision,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_coords" CHECK (("customer_addresses"."latitude" IS NULL) = ("customer_addresses"."longitude" IS NULL) AND ("customer_addresses"."latitude" IS NULL OR ("customer_addresses"."latitude" BETWEEN -90 AND 90 AND "customer_addresses"."longitude" BETWEEN -180 AND 180)))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"alt_phone_e164" text,
	"is_vip" boolean DEFAULT false NOT NULL,
	"message_locale" "locale" DEFAULT 'ar' NOT NULL,
	"notes" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_not_blank" CHECK (length(trim("customers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_line_kind" NOT NULL,
	"service_id" uuid,
	"package_id" uuid,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"beneficiary_index" integer,
	"duration_minutes" integer NOT NULL,
	"base_price_halalas" integer NOT NULL,
	"offer_price_halalas" integer,
	"vip_eligible" boolean NOT NULL,
	"vip_discount_halalas" integer DEFAULT 0 NOT NULL,
	"price_after_vip_halalas" integer NOT NULL,
	"manual_final_price_halalas" integer,
	"manual_reason" text,
	"manual_by_user_id" uuid,
	"final_price_halalas" integer NOT NULL,
	"package_snapshot" jsonb,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_prices" CHECK ("order_lines"."final_price_halalas" >= 0 AND "order_lines"."final_price_halalas" <= "order_lines"."base_price_halalas" AND "order_lines"."vip_discount_halalas" >= 0),
	CONSTRAINT "order_lines_manual_reason" CHECK ("order_lines"."manual_final_price_halalas" IS NULL OR "order_lines"."manual_final_price_halalas" = "order_lines"."price_after_vip_halalas" OR length(trim(coalesce("order_lines"."manual_reason", ''))) > 0),
	CONSTRAINT "order_lines_kind_refs" CHECK (("order_lines"."kind" = 'service' AND "order_lines"."service_id" IS NOT NULL AND "order_lines"."package_id" IS NULL) OR ("order_lines"."kind" = 'package' AND "order_lines"."package_id" IS NOT NULL AND "order_lines"."service_id" IS NULL) OR ("order_lines"."kind" = 'custom' AND "order_lines"."service_id" IS NULL AND "order_lines"."package_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_moderator_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_employee_id" uuid,
	"to_employee_id" uuid,
	"changed_by_user_id" uuid,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_id" uuid,
	"address_snapshot" jsonb,
	"persons_count" integer DEFAULT 1 NOT NULL,
	"moderator_employee_id" uuid,
	"vip_at_booking" boolean DEFAULT false NOT NULL,
	"delivery_fee_halalas" integer DEFAULT 0 NOT NULL,
	"services_total_halalas" integer DEFAULT 0 NOT NULL,
	"grand_total_halalas" integer DEFAULT 0 NOT NULL,
	"commission_rules" jsonb,
	"notes" text,
	"pending_reason" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_delivery_fee_range" CHECK ("orders"."delivery_fee_halalas" BETWEEN 0 AND 3000),
	CONSTRAINT "orders_totals_non_negative" CHECK ("orders"."services_total_halalas" >= 0 AND "orders"."grand_total_halalas" = "orders"."services_total_halalas" + "orders"."delivery_fee_halalas"),
	CONSTRAINT "orders_persons_positive" CHECK ("orders"."persons_count" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "package_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"task_duration_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "package_components_qty" CHECK ("package_components"."quantity" > 0 AND "package_components"."task_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "package_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"session_number" integer NOT NULL,
	"visit_id" uuid NOT NULL,
	CONSTRAINT "package_sessions_number_positive" CHECK ("package_sessions"."session_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"base_price_halalas" integer NOT NULL,
	"offer_price_halalas" integer NOT NULL,
	"persons_count" integer NOT NULL,
	"visits_count" integer NOT NULL,
	"visit_duration_minutes" integer NOT NULL,
	"specialists_per_visit" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_code_unique" UNIQUE("code"),
	CONSTRAINT "packages_prices_valid" CHECK ("packages"."offer_price_halalas" >= 0 AND "packages"."offer_price_halalas" <= "packages"."base_price_halalas"),
	CONSTRAINT "packages_counts_positive" CHECK ("packages"."persons_count" > 0 AND "packages"."visits_count" > 0 AND "packages"."specialists_per_visit" > 0 AND "packages"."visit_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"base_price_halalas" integer NOT NULL,
	"offer_price_halalas" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_code_unique" UNIQUE("code"),
	CONSTRAINT "services_prices_valid" CHECK ("services"."offer_price_halalas" >= 0 AND "services"."offer_price_halalas" <= "services"."base_price_halalas"),
	CONSTRAINT "services_duration_positive" CHECK ("services"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "visit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"component_service_id" uuid,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"beneficiary_index" integer,
	"specialist_employee_id" uuid,
	"task_duration_minutes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_specialists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"blocking" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "visit_status" DEFAULT 'unscheduled' NOT NULL,
	"starts_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"operational_date" date,
	"completed_at" timestamp with time zone,
	"pending_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_duration_positive" CHECK ("visits"."duration_minutes" > 0 AND "visits"."duration_minutes" <= 720),
	CONSTRAINT "visits_schedule_consistent" CHECK (("visits"."starts_at" IS NULL) = ("visits"."operational_date" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_manual_by_user_id_users_id_fk" FOREIGN KEY ("manual_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_moderator_changes" ADD CONSTRAINT "order_moderator_changes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_moderator_changes" ADD CONSTRAINT "order_moderator_changes_from_employee_id_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_moderator_changes" ADD CONSTRAINT "order_moderator_changes_to_employee_id_employees_id_fk" FOREIGN KEY ("to_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_moderator_changes" ADD CONSTRAINT "order_moderator_changes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_customer_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_moderator_employee_id_employees_id_fk" FOREIGN KEY ("moderator_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_components" ADD CONSTRAINT "package_components_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_components" ADD CONSTRAINT "package_components_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_component_service_id_services_id_fk" FOREIGN KEY ("component_service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_specialist_employee_id_employees_id_fk" FOREIGN KEY ("specialist_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_specialists" ADD CONSTRAINT "visit_specialists_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_specialists" ADD CONSTRAINT "visit_specialists_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_uq" ON "customers" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_reference_uq" ON "orders" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "package_sessions_line_session_uq" ON "package_sessions" USING btree ("order_line_id","session_number");--> statement-breakpoint
CREATE UNIQUE INDEX "package_sessions_line_visit_uq" ON "package_sessions" USING btree ("order_line_id","visit_id");--> statement-breakpoint
CREATE INDEX "visit_items_visit_idx" ON "visit_items" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visit_items_line_idx" ON "visit_items" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_specialists_uq" ON "visit_specialists" USING btree ("visit_id","employee_id");--> statement-breakpoint
CREATE INDEX "visit_specialists_employee_idx" ON "visit_specialists" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_order_sequence_uq" ON "visits" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "visits_operational_date_idx" ON "visits" USING btree ("operational_date");
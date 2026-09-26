CREATE TYPE "public"."payment_link_status" AS ENUM('creating', 'open', 'authorized', 'paid', 'failed', 'expired', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('paymob', 'tabby', 'tamara');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'paymob';--> statement-breakpoint
CREATE TABLE "payment_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"link_id" uuid,
	"event_key" text NOT NULL,
	"verified" boolean NOT NULL,
	"outcome" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_id" uuid,
	"customer_name" text,
	"customer_phone_e164" text NOT NULL,
	"amount_halalas" integer NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"description" text,
	"status" "payment_link_status" DEFAULT 'creating' NOT NULL,
	"provider_status" text,
	"provider_ref" text,
	"provider_txn_id" text,
	"checkout_url" text,
	"error_code" text,
	"paid_halalas" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_id" uuid,
	"needs_settlement" boolean DEFAULT false NOT NULL,
	"settlement_note" text,
	"settled_at" timestamp with time zone,
	"settled_by_user_id" uuid,
	"idempotency_key" text,
	"expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_amount_positive" CHECK ("payment_links"."amount_halalas" > 0),
	CONSTRAINT "payment_links_paid_range" CHECK ("payment_links"."paid_halalas" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_link_events" ADD CONSTRAINT "payment_link_events_link_id_payment_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."payment_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_settled_by_user_id_users_id_fk" FOREIGN KEY ("settled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_link_events_key_uq" ON "payment_link_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "payment_link_events_link_idx" ON "payment_link_events" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_reference_uq" ON "payment_links" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_idempotency_uq" ON "payment_links" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_links_order_idx" ON "payment_links" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_links_status_idx" ON "payment_links" USING btree ("status","created_at");
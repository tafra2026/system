CREATE TABLE "customer_document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"version" integer NOT NULL,
	"locale" "locale" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"issued_by_user_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_document_links" ADD CONSTRAINT "customer_document_links_document_id_customer_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."customer_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_document_links" ADD CONSTRAINT "customer_document_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_document_links_token_uq" ON "customer_document_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_document_links_doc_idx" ON "customer_document_links" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_documents_number_uq" ON "customer_documents" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_documents_order_version_uq" ON "customer_documents" USING btree ("order_id","locale","version");--> statement-breakpoint
CREATE INDEX "customer_documents_order_idx" ON "customer_documents" USING btree ("order_id");
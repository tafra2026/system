ALTER TABLE "customer_addresses" ADD COLUMN "photo_thumb_file_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "building_photo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "building_photo_thumb_file_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_photo_thumb_file_id_files_id_fk" FOREIGN KEY ("photo_thumb_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_building_photo_file_id_files_id_fk" FOREIGN KEY ("building_photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_building_photo_thumb_file_id_files_id_fk" FOREIGN KEY ("building_photo_thumb_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing orders keep the building photo their address has today (additive, idempotent).
UPDATE "orders" o SET "building_photo_file_id" = a."photo_file_id"
FROM "customer_addresses" a
WHERE o."address_id" = a."id" AND o."building_photo_file_id" IS NULL AND a."photo_file_id" IS NOT NULL;

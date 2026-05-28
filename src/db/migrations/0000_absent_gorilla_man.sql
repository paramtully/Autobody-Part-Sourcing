CREATE TYPE "public"."availability_status" AS ENUM('IN_STOCK', 'LOW_STOCK', 'BACKORDER', 'SPECIAL_ORDER', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."certification" AS ENUM('CAPA', 'NSF');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'KRW', 'CNY');--> statement-breakpoint
CREATE TYPE "public"."data_source_type" AS ENUM('VENDOR_API', 'SCRAPER', 'CSV_UPLOAD', 'MANUAL_ENTRY');--> statement-breakpoint
CREATE TYPE "public"."fitment_constraint" AS ENUM('WITH_RADAR', 'WITHOUT_RADAR', 'WITH_PARKING_SENSORS', 'WITHOUT_PARKING_SENSORS', 'WITH_CAMERA', 'WITHOUT_CAMERA', 'LED', 'HALOGEN', 'HID', 'ADAPTIVE', 'SUNROOF', 'NO_SUNROOF', 'AWD', 'FWD', 'RWD');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."integration_type" AS ENUM('API', 'CSV', 'SCRAPER', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'PENDING_PAYMENT', 'PAYMENT_AUTHORIZED', 'VENDOR_ORDER_PLACING', 'VENDOR_ORDER_PENDING', 'VENDOR_CONFIRMED', 'COMPLETED', 'CANCELLED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."part_category" AS ENUM('BUMPER', 'FENDER', 'DOOR', 'HOOD', 'TRUNK_LID', 'QUARTER_PANEL', 'ROOF_PANEL', 'ROCKER_PANEL', 'WHEEL_ARCH', 'HEADLIGHT', 'TAILLIGHT', 'FOG_LIGHT', 'TURN_SIGNAL', 'MARKER_LIGHT', 'REVERSE_LIGHT', 'INTERIOR_LIGHT', 'WINDSHIELD', 'REAR_WINDOW', 'SIDE_WINDOW', 'SUNROOF_GLASS', 'GRILLE', 'BUMPER_COVER', 'MOLDING', 'TRIM_PIECE', 'BADGE', 'EMBLEM', 'MIRROR', 'MIRROR_GLASS', 'MIRROR_COVER', 'DOOR_HANDLE', 'DOOR_LOCK', 'DOOR_GLASS', 'DOOR_MIRROR', 'HINGE', 'HOOD_HINGE', 'HOOD_LATCH', 'TRUNK_HINGE', 'TRUNK_LATCH', 'FENDER_LINER', 'WHEEL_WELL_LINER', 'BUMPER_BEAM', 'BUMPER_BRACKET', 'BUMPER_FOAM', 'RADIATOR_SUPPORT', 'CORE_SUPPORT', 'FRAME_RAIL', 'UNIBODY_PANEL', 'CROSSMEMBER', 'WHEEL', 'WHEEL_COVER', 'TIRE', 'PARKING_SENSOR', 'BLIND_SPOT_SENSOR', 'CAMERA', 'RADAR_SENSOR', 'HEADLIGHT_LEVELING_SENSOR', 'BRACKET', 'MOUNT', 'SUPPORT', 'WEATHERSTRIP', 'SEAL', 'GASKET', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."part_condition" AS ENUM('NEW_OEM', 'NEW_AFTERMARKET', 'RECYCLED', 'REMANUFACTURED', 'RECONDITIONED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."part_identifier_type" AS ENUM('OEM', 'AFTERMARKET', 'INTERCHANGE');--> statement-breakpoint
CREATE TYPE "public"."part_position" AS ENUM('FRONT_BUMPER', 'REAR_BUMPER', 'FRONT_LEFT_FENDER', 'FRONT_RIGHT_FENDER', 'REAR_LEFT_FENDER', 'REAR_RIGHT_FENDER', 'HOOD', 'TRUNK', 'FRONT_LEFT_DOOR', 'FRONT_RIGHT_DOOR', 'REAR_LEFT_DOOR', 'REAR_RIGHT_DOOR', 'ROOF', 'QUARTER_PANEL_LEFT', 'QUARTER_PANEL_RIGHT', 'GRILLE', 'HEADLIGHT_LEFT', 'HEADLIGHT_RIGHT', 'TAILLIGHT_LEFT', 'TAILLIGHT_RIGHT', 'MIRROR_LEFT', 'MIRROR_RIGHT', 'WINDSHIELD', 'REAR_WINDOW', 'SIDE_WINDOW_LEFT', 'SIDE_WINDOW_RIGHT', 'DOOR_HANDLE_LEFT', 'DOOR_HANDLE_RIGHT', 'FENDER_LINER_LEFT', 'FENDER_LINER_RIGHT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('STRIPE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'AUTHORIZED', 'CAPTURED', 'CANCELLED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."vendor_ordering_mode" AS ENUM('API_SYNC', 'API_ASYNC', 'EDI', 'EMAIL_MANUAL', 'NOT_SUPPORTED');--> statement-breakpoint
CREATE TYPE "public"."vendor_type" AS ENUM('OEM', 'AFTERMARKET', 'SALVAGE', 'MARKETPLACE');--> statement-breakpoint
CREATE TABLE "vendor_warehouse_locations" (
	"vendor_id" varchar(50) NOT NULL,
	"warehouse_location_id" uuid NOT NULL,
	CONSTRAINT "vendor_warehouse_locations_vendor_id_warehouse_location_id_pk" PRIMARY KEY("vendor_id","warehouse_location_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"vendor_type" "vendor_type" NOT NULL,
	"integration_type" "integration_type" NOT NULL,
	"api_endpoint" text,
	"ordering_mode" "vendor_ordering_mode" DEFAULT 'NOT_SUPPORTED' NOT NULL,
	"supports_cancellation" boolean DEFAULT false NOT NULL,
	"supports_status_lookup" boolean DEFAULT false NOT NULL,
	"order_contact_email" varchar(255),
	"average_processing_time_hours" integer,
	"reliability_score" numeric(3, 2),
	"cancellation_rate" numeric(3, 2),
	"requires_manual_ordering" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reliability_score_check" CHECK ("vendors"."reliability_score" IS NULL OR ("vendors"."reliability_score" >= 0 AND "vendors"."reliability_score" <= 1)),
	CONSTRAINT "cancellation_rate_check" CHECK ("vendors"."cancellation_rate" IS NULL OR ("vendors"."cancellation_rate" >= 0 AND "vendors"."cancellation_rate" <= 1))
);
--> statement-breakpoint
CREATE TABLE "warehouse_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" varchar(100) NOT NULL,
	"state_or_province" varchar(100),
	"city" varchar(100),
	"postal_code" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "fitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make" varchar(100) NOT NULL,
	"model" varchar(100) NOT NULL,
	"year" integer NOT NULL,
	"constraint" "fitment_constraint",
	"trim" varchar(255),
	"engine" varchar(255),
	CONSTRAINT "fitments_unique" UNIQUE("make","model","year","constraint","trim","engine")
);
--> statement-breakpoint
CREATE TABLE "part_fitments" (
	"part_id" uuid NOT NULL,
	"fitment_id" uuid NOT NULL,
	CONSTRAINT "part_fitments_part_id_fitment_id_pk" PRIMARY KEY("part_id","fitment_id")
);
--> statement-breakpoint
CREATE TABLE "part_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"type" "part_identifier_type" NOT NULL,
	"value" varchar(255) NOT NULL,
	"manufacturer" varchar(255),
	"certification" "certification",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_identifiers_unique" UNIQUE("part_id","type","value","manufacturer")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" "part_category" NOT NULL,
	"position" "part_position",
	"description" text,
	"weight_grams" integer,
	"is_discontinued" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_name_category_unique" UNIQUE("name","category")
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"url" text PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"image_type" text,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" varchar(50) NOT NULL,
	"part_identifier_id" uuid NOT NULL,
	"vendor_listing_external_id" varchar(255),
	"source_url" text,
	"condition" "part_condition" NOT NULL,
	"description" text,
	"source_vehicle_vin" varchar(17),
	"source_mileage" integer,
	"source_damage_type" varchar(50),
	"quantity_available" integer,
	"availability_status" "availability_status" NOT NULL,
	"price_minor_min" integer NOT NULL,
	"price_minor_max" integer,
	"currency" "currency" NOT NULL,
	"warehouse_location_id" uuid,
	"estimated_ship_time_hours" integer,
	"estimated_delivery_date" timestamp with time zone,
	"source" "data_source_type" NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence_score" numeric(3, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"payload_hash" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_vendor_external_id_unique" UNIQUE("vendor_id","vendor_listing_external_id"),
	CONSTRAINT "price_minor_min_check" CHECK ("listings"."price_minor_min" >= 0),
	CONSTRAINT "quantity_available_check" CHECK ("listings"."quantity_available" IS NULL OR "listings"."quantity_available" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checkout_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"part_price_minor" integer NOT NULL,
	"service_fee_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"vendor_quote_reference" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"status" "order_status" NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(50),
	"order_lookup_token" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"listing_id" uuid NOT NULL,
	"vendor_id" varchar(50) NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"part_price_minor" integer NOT NULL,
	"service_fee_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"total_refunded_minor" integer DEFAULT 0 NOT NULL,
	"vendor_order_id" varchar(255),
	"claimed_at" timestamp with time zone,
	"payment_provider_payment_id" varchar(255),
	"payment_status" "payment_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_order_lookup_token_unique" UNIQUE("order_lookup_token"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "total_minor_min_check" CHECK ("orders"."total_minor" >= 100),
	CONSTRAINT "total_refunded_max_check" CHECK ("orders"."total_refunded_minor" <= "orders"."total_minor")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" varchar(50) NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"last_cursor" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_chunk_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{"processed":0,"succeeded":0,"failed":0,"skipped":0,"pagesFetched":0}' NOT NULL,
	"error_message" text,
	CONSTRAINT "stats_not_null_check" CHECK ("ingestion_runs"."stats" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(100) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_warehouse_locations" ADD CONSTRAINT "vendor_warehouse_locations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_warehouse_locations" ADD CONSTRAINT "vendor_warehouse_locations_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_fitment_id_fitments_id_fk" FOREIGN KEY ("fitment_id") REFERENCES "public"."fitments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_identifiers" ADD CONSTRAINT "part_identifiers_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_part_identifier_id_part_identifiers_id_fk" FOREIGN KEY ("part_identifier_id") REFERENCES "public"."part_identifiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_quotes" ADD CONSTRAINT "checkout_quotes_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fitments_make_model_year_idx" ON "fitments" USING btree ("make","model","year");--> statement-breakpoint
CREATE INDEX "part_identifiers_value_idx" ON "part_identifiers" USING btree ("value");--> statement-breakpoint
CREATE INDEX "listing_images_listing_id_idx" ON "listing_images" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listings_part_identifier_id_idx" ON "listings" USING btree ("part_identifier_id");--> statement-breakpoint
CREATE INDEX "listings_vendor_id_idx" ON "listings" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "listings_is_active_status_idx" ON "listings" USING btree ("is_active","availability_status");--> statement-breakpoint
CREATE INDEX "listings_vendor_part_active_idx" ON "listings" USING btree ("vendor_id","part_identifier_id","is_active");--> statement-breakpoint
CREATE INDEX "listings_payload_hash_idx" ON "listings" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "listings_vendor_active_last_seen_idx" ON "listings" USING btree ("vendor_id","is_active","last_seen_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingestion_runs_vendor_status_idx" ON "ingestion_runs" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "ingestion_runs_vendor_completed_idx" ON "ingestion_runs" USING btree ("vendor_id","completed_at");--> statement-breakpoint
CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events" USING btree ("published_at","created_at");
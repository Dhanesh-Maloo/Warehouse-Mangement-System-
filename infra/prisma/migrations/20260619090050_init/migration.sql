-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('operator', 'manager', 'admin', 'client_user');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('laptop', 'monitor', 'peripheral');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('receiving', 'in_inspection', 'in_storage', 'deployed', 'returning', 'disposed');

-- CreateEnum
CREATE TYPE "ConditionGrade" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'partially_received', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('inbound', 'outbound', 'periodic');

-- CreateEnum
CREATE TYPE "RateBasis" AS ENUM ('per_device', 'per_shipment', 'monthly_per_device', 'per_label');

-- CreateEnum
CREATE TYPE "RateCategoryApplies" AS ENUM ('laptop', 'monitor', 'peripheral', 'any');

-- CreateTable
CREATE TABLE "clients" (
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "gstin" TEXT,
    "billing_address" JSONB,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "committed_monthly_amount_paise" BIGINT NOT NULL DEFAULT 4275000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "client_id" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "locations" (
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "bin_code" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "assets" (
    "asset_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "asset_tag" TEXT,
    "model" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "client_id" TEXT NOT NULL,
    "current_status" "AssetStatus" NOT NULL DEFAULT 'receiving',
    "current_location_id" TEXT,
    "condition_grade" "ConditionGrade",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "expected_deliveries" (
    "delivery_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "purchase_order_ref" TEXT NOT NULL,
    "expected_arrival_date" DATE NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expected_deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "expected_delivery_items" (
    "item_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "model" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expected_delivery_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "goods_received_notes" (
    "grn_id" TEXT NOT NULL,
    "expected_delivery_id" TEXT NOT NULL,
    "received_by_user_id" TEXT NOT NULL,
    "receiving_location_id" TEXT NOT NULL,
    "courier_ref" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL,
    "device_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_received_notes_pkey" PRIMARY KEY ("grn_id")
);

-- CreateTable
CREATE TABLE "grn_assets" (
    "grn_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "requires_inspection" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "grn_assets_pkey" PRIMARY KEY ("grn_id","asset_id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "inspection_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ NOT NULL,
    "started_by_user_id" TEXT NOT NULL,
    "assigned_to_user_id" TEXT,
    "completed_at" TIMESTAMPTZ,
    "completed_by_user_id" TEXT,
    "condition_grade" "ConditionGrade",
    "power_on" BOOLEAN,
    "screen_intact" BOOLEAN,
    "battery_health_ok" BOOLEAN,
    "no_physical_damage" BOOLEAN,
    "all_ports_functional" BOOLEAN,
    "data_wiped" BOOLEAN,
    "notes" TEXT,
    "sla_minutes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("inspection_id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "photo_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("photo_id")
);

-- CreateTable
CREATE TABLE "rate_card_items" (
    "rate_item_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "basis" "RateBasis" NOT NULL,
    "category_applies" "RateCategoryApplies" NOT NULL,
    "unit_rate_paise" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_bundle" BOOLEAN NOT NULL DEFAULT false,
    "bundle_component_codes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_card_items_pkey" PRIMARY KEY ("rate_item_id")
);

-- CreateTable
CREATE TABLE "events_ledger" (
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "location_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_rate_paise" BIGINT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_by" TEXT NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_ledger_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "log_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "holiday_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("holiday_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_zone_code_bin_code_key" ON "locations"("zone_code", "bin_code");

-- CreateIndex
CREATE UNIQUE INDEX "assets_serial_number_key" ON "assets"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_tag_key" ON "assets"("asset_tag");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "locations"("location_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_deliveries" ADD CONSTRAINT "expected_deliveries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_delivery_items" ADD CONSTRAINT "expected_delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "expected_deliveries"("delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_expected_delivery_id_fkey" FOREIGN KEY ("expected_delivery_id") REFERENCES "expected_deliveries"("delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_receiving_location_id_fkey" FOREIGN KEY ("receiving_location_id") REFERENCES "locations"("location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_assets" ADD CONSTRAINT "grn_assets_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "goods_received_notes"("grn_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_assets" ADD CONSTRAINT "grn_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("inspection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events_ledger" ADD CONSTRAINT "events_ledger_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events_ledger" ADD CONSTRAINT "events_ledger_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

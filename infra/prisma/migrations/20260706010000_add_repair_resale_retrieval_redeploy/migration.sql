-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'in_repair';
ALTER TYPE "AssetStatus" ADD VALUE 'for_resale';

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('pending', 'sent', 'in_repair', 'returned', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ResaleStatus" AS ENUM ('listed', 'sold', 'cancelled');

-- AlterTable
ALTER TABLE "retrieval_requests"
  ADD COLUMN "requires_wipe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requires_redeploy_setup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "redeploy_end_user_id" TEXT,
  ADD COLUMN "redeploy_delivery_address" JSONB,
  ADD COLUMN "redeploy_contact_name" TEXT,
  ADD COLUMN "redeploy_contact_phone" TEXT,
  ADD COLUMN "damage_found" BOOLEAN;

-- AlterTable
ALTER TABLE "inspections"
  ADD COLUMN "source_retrieval_id" TEXT;

-- CreateTable
CREATE TABLE "repair_requests" (
    "repair_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "service_center_name" TEXT NOT NULL,
    "estimate_cost_paise" BIGINT,
    "status" "RepairStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "returned_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repair_requests_pkey" PRIMARY KEY ("repair_id")
);

-- CreateTable
CREATE TABLE "resale_listings" (
    "resale_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "listed_price_paise" BIGINT,
    "status" "ResaleStatus" NOT NULL DEFAULT 'listed',
    "sold_price_paise" BIGINT,
    "sold_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "listed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resale_listings_pkey" PRIMARY KEY ("resale_id")
);

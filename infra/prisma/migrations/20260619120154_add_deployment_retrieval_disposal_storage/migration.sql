/*
  Warnings:

  - You are about to drop the column `default_shipping_address` on the `end_users` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `end_users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DeploymentOrderStatus" AS ENUM ('pending', 'picking', 'packed', 'dispatched', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "DeploymentBundleType" AS ENUM ('standard', 'full_prep');

-- CreateEnum
CREATE TYPE "CourierZone" AS ENUM ('intra_state', 'inter_state', 'rural');

-- CreateEnum
CREATE TYPE "RetrievalStatus" AS ENUM ('pending', 'initiated', 'in_transit', 'received', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RetrievalBundleType" AS ENUM ('standard', 'full_cycle');

-- CreateEnum
CREATE TYPE "DisposalType" AS ENUM ('non_certified', 'certified_blanco', 'itad_bundled');

-- CreateEnum
CREATE TYPE "DisposalStatus" AS ENUM ('pending', 'approved', 'in_progress', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "end_users" DROP COLUMN "default_shipping_address",
DROP COLUMN "notes",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN     "employee_id" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "deployment_orders" (
    "order_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "end_user_id" TEXT,
    "bundle_type" "DeploymentBundleType" NOT NULL DEFAULT 'standard',
    "delivery_address" JSONB NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "courier_zone" "CourierZone" NOT NULL,
    "tracking_number" TEXT,
    "courier_name" TEXT,
    "actual_carrier_cost_paise" BIGINT,
    "requires_labeling" BOOLEAN NOT NULL DEFAULT false,
    "requires_repacking" BOOLEAN NOT NULL DEFAULT false,
    "status" "DeploymentOrderStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "dispatched_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "created_by_user_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deployment_orders_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "retrieval_requests" (
    "retrieval_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "bundle_type" "RetrievalBundleType" NOT NULL DEFAULT 'standard',
    "pickup_address" JSONB NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "courier_zone" "CourierZone" NOT NULL,
    "tracking_number" TEXT,
    "requires_post_inspection" BOOLEAN NOT NULL DEFAULT false,
    "status" "RetrievalStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initiated_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_by_user_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "retrieval_requests_pkey" PRIMARY KEY ("retrieval_id")
);

-- CreateTable
CREATE TABLE "disposal_requests" (
    "disposal_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "disposal_type" "DisposalType" NOT NULL,
    "status" "DisposalStatus" NOT NULL DEFAULT 'pending',
    "approved_at" TIMESTAMPTZ,
    "initiated_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "certificate_s3_key" TEXT,
    "approved_by_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "disposal_requests_pkey" PRIMARY KEY ("disposal_id")
);

-- CreateTable
CREATE TABLE "storage_accrual_runs" (
    "run_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "laptop_count" INTEGER NOT NULL,
    "peripheral_count" INTEGER NOT NULL,
    "total_device_count" INTEGER NOT NULL,
    "laptop_amount_paise" BIGINT NOT NULL,
    "peripheral_amount_paise" BIGINT NOT NULL,
    "total_amount_paise" BIGINT NOT NULL,
    "minimum_commitment_paise" BIGINT NOT NULL,
    "minimum_commitment_met" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_accrual_runs_pkey" PRIMARY KEY ("run_id")
);

-- AddForeignKey
ALTER TABLE "deployment_orders" ADD CONSTRAINT "deployment_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_orders" ADD CONSTRAINT "deployment_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_orders" ADD CONSTRAINT "deployment_orders_end_user_id_fkey" FOREIGN KEY ("end_user_id") REFERENCES "end_users"("end_user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_orders" ADD CONSTRAINT "deployment_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_requests" ADD CONSTRAINT "retrieval_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_requests" ADD CONSTRAINT "disposal_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_requests" ADD CONSTRAINT "disposal_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_requests" ADD CONSTRAINT "disposal_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disposal_requests" ADD CONSTRAINT "disposal_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_accrual_runs" ADD CONSTRAINT "storage_accrual_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

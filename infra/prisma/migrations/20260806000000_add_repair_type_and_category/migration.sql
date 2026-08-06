-- CreateEnum
CREATE TYPE "RepairType" AS ENUM ('oem_warranty', 'in_house');

-- CreateEnum
CREATE TYPE "RepairCategory" AS ENUM ('software', 'hardware');

-- AlterTable
ALTER TABLE "repair_requests"
  ADD COLUMN "repair_type" "RepairType" NOT NULL DEFAULT 'in_house',
  ADD COLUMN "repair_category" "RepairCategory",
  ADD COLUMN "sla_updated_at" TIMESTAMPTZ;

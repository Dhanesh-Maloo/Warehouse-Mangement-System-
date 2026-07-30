-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'sold';

-- AlterTable
ALTER TABLE "repair_requests"
  ADD COLUMN "sla_target_at" TIMESTAMPTZ;

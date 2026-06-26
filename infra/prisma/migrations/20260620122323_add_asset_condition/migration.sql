-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('new', 'used', 'dead');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "asset_condition" "AssetCondition";

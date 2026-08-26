-- AlterEnum
ALTER TYPE "RepairType" ADD VALUE 'out_of_warranty';

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('ivalue', 'client');

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN "ticket_source" "TicketSource";

-- AlterTable
ALTER TABLE "asset_documents" ADD COLUMN "repair_request_id" TEXT;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_repair_request_id_fkey" FOREIGN KEY ("repair_request_id") REFERENCES "repair_requests"("repair_id") ON DELETE SET NULL ON UPDATE CASCADE;

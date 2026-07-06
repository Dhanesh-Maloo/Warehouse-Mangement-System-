-- AlterTable
ALTER TABLE "disposal_requests"
  ADD COLUMN "requires_certification" BOOLEAN NOT NULL DEFAULT false;

-- Repair requests now require sign-off from a designated manager
-- (admin/manager/client_admin) before moving from 'pending' to 'sent'.
ALTER TYPE "RepairStatus" ADD VALUE IF NOT EXISTS 'approved' BEFORE 'sent';

ALTER TABLE "repair_requests" ADD COLUMN "approved_at" TIMESTAMPTZ;
ALTER TABLE "repair_requests" ADD COLUMN "approved_by_user_id" TEXT;

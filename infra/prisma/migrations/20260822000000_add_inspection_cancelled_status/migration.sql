-- The Prisma schema (and the inspection-cancel feature) has declared
-- 'cancelled' as a valid InspectionStatus since it was written, but no
-- migration ever added it to the deployed enum — the init migration only
-- created ('in_progress', 'completed', 'failed'). This backfills the
-- missing enum value so InspectionsService.cancel() can persist it.
ALTER TYPE "InspectionStatus" ADD VALUE IF NOT EXISTS 'cancelled';

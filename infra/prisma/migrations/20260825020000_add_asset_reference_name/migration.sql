-- Client's own internal reference/name for a device, distinct from our
-- serial number and asset tag. Optional.

ALTER TABLE "assets" ADD COLUMN "reference_name" TEXT;

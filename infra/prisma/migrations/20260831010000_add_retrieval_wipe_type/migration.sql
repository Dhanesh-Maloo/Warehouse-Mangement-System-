-- The "Requires data wipe" checkbox on a retrieval request now requires
-- choosing a billed tier — Non-Certified or Certified Data Destruction —
-- mirroring the Disposal module's non_certified/certified_blanco wording
-- and pricing, instead of a single flat WIPE charge.
CREATE TYPE "WipeType" AS ENUM ('non_certified', 'certified_blanco');

ALTER TABLE "retrieval_requests" ADD COLUMN "wipe_type" "WipeType";

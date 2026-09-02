-- Per-client monthly minimum committed storage spend. Null on all three
-- columns means "no commitment" — that client's storage bills stay exactly
-- as they were (pure per-device), preserving current behavior for every
-- existing client until a commitment is explicitly configured for them.
ALTER TABLE "clients" ADD COLUMN "commitment_amount_paise" BIGINT;
ALTER TABLE "clients" ADD COLUMN "commitment_laptop_count" INTEGER;
ALTER TABLE "clients" ADD COLUMN "commitment_peripheral_count" INTEGER;

ALTER TABLE "storage_accrual_runs" ADD COLUMN "commitment_amount_paise" BIGINT NOT NULL DEFAULT 0;
-- Backfill: every existing run predates commitments, so the full stored
-- count was what got billed.
ALTER TABLE "storage_accrual_runs" ADD COLUMN "billable_laptop_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "storage_accrual_runs" ADD COLUMN "billable_peripheral_count" INTEGER NOT NULL DEFAULT 0;
UPDATE "storage_accrual_runs" SET
  "billable_laptop_count" = "laptop_count",
  "billable_peripheral_count" = "peripheral_count";

-- Esevel's negotiated commitment per the rate contract: ₹42,750/month flat,
-- covering up to 300 laptops and 300 peripherals; devices beyond either
-- threshold are billed per-device on top, same as before.
UPDATE "clients" SET
  "commitment_amount_paise" = 4275000,
  "commitment_laptop_count" = 300,
  "commitment_peripheral_count" = 300
WHERE "slug" = 'esevel';

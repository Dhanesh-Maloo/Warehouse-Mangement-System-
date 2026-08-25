-- Remove the committed-monthly-amount / minimum-commitment concept entirely.
-- Product decision (2026-08-25): storage billing no longer enforces or reports
-- a per-client minimum commitment floor. This drops the columns rather than
-- just hiding them in the app, per explicit instruction to remove it from the
-- whole system.

ALTER TABLE "clients" DROP COLUMN "committed_monthly_amount_paise";

ALTER TABLE "storage_accrual_runs" DROP COLUMN "minimum_commitment_paise";
ALTER TABLE "storage_accrual_runs" DROP COLUMN "minimum_commitment_met";

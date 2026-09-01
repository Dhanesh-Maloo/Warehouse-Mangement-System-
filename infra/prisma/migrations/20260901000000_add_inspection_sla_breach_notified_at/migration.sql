-- Tracks whether the SLA-breach email has already been sent for an
-- inspection, so the periodic check (every 15 min) never re-notifies for
-- the same breach.
ALTER TABLE "inspections" ADD COLUMN "sla_breach_notified_at" TIMESTAMPTZ;

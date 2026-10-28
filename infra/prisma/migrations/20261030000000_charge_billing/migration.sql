-- Tracks which ledger charges have been invoiced. The ledger stays append-only; billed state
-- is a separate record, and undoing a batch deletes it.
CREATE TABLE "charge_billing_batches" (
    "batch_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "event_count" INTEGER NOT NULL,
    "total_amount_paise" BIGINT NOT NULL,
    "billed_by" TEXT NOT NULL,
    "billed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_billing_batches_pkey" PRIMARY KEY ("batch_id")
);

CREATE TABLE "charge_billed_events" (
    "event_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,

    CONSTRAINT "charge_billed_events_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "charge_billing_batches_client_id_billed_at_idx" ON "charge_billing_batches"("client_id", "billed_at");
CREATE INDEX "charge_billed_events_batch_id_idx" ON "charge_billed_events"("batch_id");

ALTER TABLE "charge_billing_batches" ADD CONSTRAINT "charge_billing_batches_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "charge_billed_events" ADD CONSTRAINT "charge_billed_events_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "charge_billing_batches"("batch_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charge_billed_events" ADD CONSTRAINT "charge_billed_events_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events_ledger"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

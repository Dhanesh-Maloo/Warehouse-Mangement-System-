-- One-time inbound fee tracking for devices added outside the inbound flow
-- (no INGEST ledger event). Records what was invoiced; the ledger is untouched.
CREATE TABLE "inbound_billings" (
    "inbound_billing_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "laptop_count" INTEGER NOT NULL,
    "peripheral_count" INTEGER NOT NULL,
    "laptop_amount_paise" BIGINT NOT NULL,
    "peripheral_amount_paise" BIGINT NOT NULL,
    "total_amount_paise" BIGINT NOT NULL,
    "billed_by" TEXT NOT NULL,
    "billed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_billings_pkey" PRIMARY KEY ("inbound_billing_id")
);

CREATE INDEX "inbound_billings_client_id_billing_month_idx" ON "inbound_billings"("client_id", "billing_month");

ALTER TABLE "inbound_billings" ADD CONSTRAINT "inbound_billings_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assets" ADD COLUMN "inbound_billing_id" TEXT;

ALTER TABLE "assets" ADD CONSTRAINT "assets_inbound_billing_id_fkey"
    FOREIGN KEY ("inbound_billing_id") REFERENCES "inbound_billings"("inbound_billing_id") ON DELETE SET NULL ON UPDATE CASCADE;

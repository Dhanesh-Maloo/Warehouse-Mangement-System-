-- Tracks every Asset.currentStatus transition so billing/reporting can
-- reconstruct time-in-status over an arbitrary period (e.g. days in
-- in_storage during a given month). Append-only, written alongside the
-- Asset update at every status-changing call site.

CREATE TABLE "asset_status_history" (
    "history_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "from_status" "AssetStatus",
    "to_status" "AssetStatus" NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_module" TEXT NOT NULL,

    CONSTRAINT "asset_status_history_pkey" PRIMARY KEY ("history_id")
);

CREATE INDEX "asset_status_history_asset_id_changed_at_idx" ON "asset_status_history"("asset_id", "changed_at");

ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

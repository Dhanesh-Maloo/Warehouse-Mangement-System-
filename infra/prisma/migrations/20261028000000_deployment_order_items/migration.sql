-- A deployment order (one shipment) can now carry several assets.
-- orders.asset_id stays as the primary asset; every order's assets live here.
CREATE TABLE "deployment_order_items" (
    "item_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_order_items_pkey" PRIMARY KEY ("item_id")
);

CREATE UNIQUE INDEX "deployment_order_items_order_id_asset_id_key" ON "deployment_order_items"("order_id", "asset_id");
CREATE INDEX "deployment_order_items_asset_id_idx" ON "deployment_order_items"("asset_id");

ALTER TABLE "deployment_order_items" ADD CONSTRAINT "deployment_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "deployment_orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deployment_order_items" ADD CONSTRAINT "deployment_order_items_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing order shipped exactly its one asset.
INSERT INTO "deployment_order_items" ("item_id", "order_id", "asset_id")
SELECT gen_random_uuid()::text, "order_id", "asset_id" FROM "deployment_orders";

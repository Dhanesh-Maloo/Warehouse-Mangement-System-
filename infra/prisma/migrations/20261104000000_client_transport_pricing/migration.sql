-- Per-client transport pricing: billed = typed amount + markup %, then GST % on that sum.
-- Stored as basis points (1500 = 15%). NULL on both columns means "bill the amount as typed".
ALTER TABLE "clients" ADD COLUMN "transport_markup_bps" INTEGER;
ALTER TABLE "clients" ADD COLUMN "transport_gst_bps" INTEGER;
-- The typed amount is kept so editing an order never re-applies the markup to an already marked-up total.
ALTER TABLE "deployment_orders" ADD COLUMN "transport_base_paise" BIGINT;

-- Esevel: 15% markup, then 18% GST.
UPDATE "clients" SET "transport_markup_bps" = 1500, "transport_gst_bps" = 1800 WHERE "slug" = 'esevel';

-- PO reference is not always available when a delivery is logged (e.g. no
-- formal PO exists yet) — make it optional instead of required.
ALTER TABLE "expected_deliveries" ALTER COLUMN "purchase_order_ref" DROP NOT NULL;

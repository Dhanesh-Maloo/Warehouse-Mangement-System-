-- Transport is now a manual amount (ledger event TRANSPORT) instead of a zone rate.
-- The redeploy leg is billed later, so its amount is carried on the retrieval request.
ALTER TABLE "retrieval_requests" ADD COLUMN "redeploy_transport_charge_paise" BIGINT;

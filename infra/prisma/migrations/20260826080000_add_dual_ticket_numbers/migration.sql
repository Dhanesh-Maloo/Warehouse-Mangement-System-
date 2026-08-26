-- Inspections: replace single ticket_number + ticket_source with two explicit
-- ticket-number fields (iValue side vs client side).
ALTER TABLE "inspections" DROP COLUMN "ticket_number";
ALTER TABLE "inspections" DROP COLUMN "ticket_source";
DROP TYPE "TicketSource";
ALTER TABLE "inspections" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "inspections" ADD COLUMN "client_ticket_number" TEXT;

-- Same two fields, added to every other module that tracks work against a ticket.
ALTER TABLE "expected_deliveries" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "expected_deliveries" ADD COLUMN "client_ticket_number" TEXT;

ALTER TABLE "deployment_orders" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "deployment_orders" ADD COLUMN "client_ticket_number" TEXT;

ALTER TABLE "retrieval_requests" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "retrieval_requests" ADD COLUMN "client_ticket_number" TEXT;

ALTER TABLE "disposal_requests" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "disposal_requests" ADD COLUMN "client_ticket_number" TEXT;

ALTER TABLE "repair_requests" ADD COLUMN "ivalue_ticket_number" TEXT;
ALTER TABLE "repair_requests" ADD COLUMN "client_ticket_number" TEXT;

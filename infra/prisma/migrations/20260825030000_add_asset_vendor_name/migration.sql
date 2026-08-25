-- Who a device was purchased from (e.g. iValue vs another vendor). Optional,
-- captured per device at receiving time.

ALTER TABLE "assets" ADD COLUMN "vendor_name" TEXT;

-- AlterTable
ALTER TABLE "goods_received_notes" ADD COLUMN     "grn_number" TEXT;

-- CreateTable
CREATE TABLE "end_users" (
    "end_user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "default_shipping_address" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "end_users_pkey" PRIMARY KEY ("end_user_id")
);

-- AddForeignKey
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

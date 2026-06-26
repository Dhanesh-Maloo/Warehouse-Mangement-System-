-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "current_end_user_id" TEXT;

-- AlterTable
ALTER TABLE "goods_received_notes" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN     "sla_target_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "event_suppressions" (
    "suppression_id" TEXT NOT NULL,
    "suppressed_event_id" TEXT NOT NULL,
    "suppressed_by_event_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_suppressions_pkey" PRIMARY KEY ("suppression_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_suppressions_suppressed_event_id_key" ON "event_suppressions"("suppressed_event_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_end_user_id_fkey" FOREIGN KEY ("current_end_user_id") REFERENCES "end_users"("end_user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "rural_pincodes" (
    "rural_pincode_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "rural_pincodes_pkey" PRIMARY KEY ("rural_pincode_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rural_pincodes_pincode_key" ON "rural_pincodes"("pincode");

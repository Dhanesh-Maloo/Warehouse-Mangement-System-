-- AlterTable assets: add repair/logistics/disposal columns added to schema without a migration
ALTER TABLE "assets"
  ADD COLUMN IF NOT EXISTS "repair_handling"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "repair_service_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "repair_estimate_cost" INTEGER,
  ADD COLUMN IF NOT EXISTS "awb_number"           TEXT,
  ADD COLUMN IF NOT EXISTS "courier_name"         TEXT,
  ADD COLUMN IF NOT EXISTS "delivered_at"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "disposal_type"        TEXT,
  ADD COLUMN IF NOT EXISTS "has_certification"    BOOLEAN;

-- AlterTable inspections: add all checklist columns added to schema without a migration
ALTER TABLE "inspections"
  ADD COLUMN IF NOT EXISTS "scratches_on_casing"    BOOLEAN,
  ADD COLUMN IF NOT EXISTS "lid_closing_ok"          BOOLEAN,
  ADD COLUMN IF NOT EXISTS "scratches_on_screen"     BOOLEAN,
  ADD COLUMN IF NOT EXISTS "keyboard_issues"         BOOLEAN,
  ADD COLUMN IF NOT EXISTS "missing_feet"            BOOLEAN,
  ADD COLUMN IF NOT EXISTS "charger_damage"          BOOLEAN,
  ADD COLUMN IF NOT EXISTS "all_accessories_present" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "webcam_ok"               BOOLEAN,
  ADD COLUMN IF NOT EXISTS "speakers_ok"             BOOLEAN,
  ADD COLUMN IF NOT EXISTS "bluetooth_ok"            BOOLEAN,
  ADD COLUMN IF NOT EXISTS "battery_charges"         BOOLEAN,
  ADD COLUMN IF NOT EXISTS "screen_ok"               BOOLEAN,
  ADD COLUMN IF NOT EXISTS "keyboard_ok"             BOOLEAN,
  ADD COLUMN IF NOT EXISTS "trackpad_ok"             BOOLEAN,
  ADD COLUMN IF NOT EXISTS "ports_ok"                BOOLEAN,
  ADD COLUMN IF NOT EXISTS "powers_on_ok"            BOOLEAN,
  ADD COLUMN IF NOT EXISTS "images_uploaded"         BOOLEAN,
  ADD COLUMN IF NOT EXISTS "sanitization"            BOOLEAN,
  ADD COLUMN IF NOT EXISTS "factory_reset"           BOOLEAN,
  ADD COLUMN IF NOT EXISTS "notes"                   TEXT,
  ADD COLUMN IF NOT EXISTS "sla_minutes"             INTEGER,
  ADD COLUMN IF NOT EXISTS "sla_target_at"           TIMESTAMPTZ;

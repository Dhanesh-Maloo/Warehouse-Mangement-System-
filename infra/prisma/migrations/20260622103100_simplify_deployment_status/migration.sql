-- Migrate existing picking/packed/dispatched orders to in_transit before changing the enum

-- Step 1: drop the default so the column type can be altered
ALTER TABLE "deployment_orders" ALTER COLUMN "status" DROP DEFAULT;

-- Step 2: rename old type, create new type
ALTER TYPE "DeploymentOrderStatus" RENAME TO "DeploymentOrderStatus_old";

CREATE TYPE "DeploymentOrderStatus" AS ENUM ('pending', 'in_transit', 'delivered', 'cancelled');

-- Step 3: update the column, mapping old values to new ones
ALTER TABLE "deployment_orders"
  ALTER COLUMN "status" TYPE "DeploymentOrderStatus"
  USING (
    CASE "status"::text
      WHEN 'picking'    THEN 'in_transit'
      WHEN 'packed'     THEN 'in_transit'
      WHEN 'dispatched' THEN 'in_transit'
      ELSE "status"::text
    END
  )::"DeploymentOrderStatus";

-- Step 4: restore the default
ALTER TABLE "deployment_orders" ALTER COLUMN "status" SET DEFAULT 'pending'::"DeploymentOrderStatus";

-- Step 5: drop old type
DROP TYPE "DeploymentOrderStatus_old";

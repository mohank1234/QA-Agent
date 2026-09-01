-- AlterTable
ALTER TABLE "test_executions" ADD COLUMN     "healed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "healed_from_locator" TEXT,
ADD COLUMN     "healed_to_locator" TEXT;

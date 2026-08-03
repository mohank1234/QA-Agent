-- AlterTable
ALTER TABLE "projects" ADD COLUMN "created_by" TEXT;
ALTER TABLE "projects" ADD COLUMN "owner_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "updated_by" TEXT;

-- CreateIndex
CREATE INDEX "idx_projects_owner" ON "projects"("owner_id");


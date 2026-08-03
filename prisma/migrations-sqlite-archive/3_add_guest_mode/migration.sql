-- AlterTable
ALTER TABLE "projects" ADD COLUMN "expires_at" TEXT;
ALTER TABLE "projects" ADD COLUMN "guest_id" TEXT;

-- CreateIndex
CREATE INDEX "idx_projects_guest" ON "projects"("guest_id");


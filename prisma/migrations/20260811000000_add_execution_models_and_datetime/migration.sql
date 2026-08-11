-- Phase 1: execution data model + String->DateTime date migration.
--
-- HAND-EDITED. `prisma migrate diff` generates `DROP COLUMN "x", ADD COLUMN
-- "x" TIMESTAMP(3) NOT NULL` for every one of the type changes below. That is
-- not usable here for two independent reasons:
--   1. it discards every existing timestamp value, and
--   2. it would fail outright anyway — Postgres rejects ADD COLUMN ... NOT
--      NULL without a DEFAULT on a table that already has rows.
-- The in-place ALTER ... TYPE ... USING form below preserves the data.
--
-- The cast is ::timestamp(3), deliberately NOT ::timestamptz. Every existing
-- value is `new Date().toISOString()` output (ISO-8601, UTC, trailing 'Z').
-- ::timestamp(3) parses the literal date/time fields and ignores the 'Z',
-- yielding exactly the original UTC wall-clock time — which is how Prisma
-- reads a TIMESTAMP(3) column back. Going via ::timestamptz would instead
-- resolve to an instant and then re-render it through the *session* TimeZone
-- on the way into the timestamp column, shifting every value by the server's
-- UTC offset. This form is time-zone independent.

-- AlterTable: projects
ALTER TABLE "projects"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3),
  ALTER COLUMN "expires_at" TYPE TIMESTAMP(3) USING "expires_at"::timestamp(3);

-- AlterTable: documents
ALTER TABLE "documents"
  ALTER COLUMN "uploaded_at" TYPE TIMESTAMP(3) USING "uploaded_at"::timestamp(3);

-- AlterTable: requirements
ALTER TABLE "requirements"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3);

-- AlterTable: benchmark_rows
ALTER TABLE "benchmark_rows"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3);

-- AlterTable: messages
ALTER TABLE "messages"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3);

-- AlterTable: generated_documents
ALTER TABLE "generated_documents"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3);

-- AlterTable: test_cases (date conversion + execution output columns)
ALTER TABLE "test_cases"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3),
  ADD COLUMN "scenario_ref" TEXT,
  ADD COLUMN "actual_result" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "comments" TEXT,
  ADD COLUMN "last_executed_at" TIMESTAMP(3);

-- AlterTable: bug_reports (date conversion + the fields the bug-report format
-- requires). date_reported is added nullable, backfilled from the
-- already-converted created_at, and only then locked to NOT NULL — the
-- three-step form is what makes a NOT NULL column addable to a populated
-- table without inventing a default.
ALTER TABLE "bug_reports"
  ALTER COLUMN "created_at" TYPE TIMESTAMP(3) USING "created_at"::timestamp(3),
  ADD COLUMN "module" TEXT,
  ADD COLUMN "preconditions" TEXT,
  ADD COLUMN "test_data" TEXT,
  ADD COLUMN "frequency" TEXT,
  ADD COLUMN "comments" TEXT,
  ADD COLUMN "attachments_json" TEXT,
  ADD COLUMN "date_reported" TIMESTAMP(3);

UPDATE "bug_reports" SET "date_reported" = "created_at" WHERE "date_reported" IS NULL;

ALTER TABLE "bug_reports" ALTER COLUMN "date_reported" SET NOT NULL;

-- CreateTable
CREATE TABLE "test_scenarios" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "priority" TEXT,
    "source_requirement" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_scripts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "script_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "test_type" TEXT NOT NULL,
    "case_ref" TEXT,
    "url" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "script_id" TEXT,
    "label" TEXT,
    "status" TEXT NOT NULL,
    "triggered_by" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_executions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "case_id" TEXT,
    "passed" BOOLEAN NOT NULL,
    "actual_result" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "executed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_test_scenarios_project" ON "test_scenarios"("project_id");

-- CreateIndex
CREATE INDEX "idx_test_scripts_project" ON "test_scripts"("project_id");

-- CreateIndex
CREATE INDEX "idx_test_runs_project" ON "test_runs"("project_id");

-- CreateIndex
CREATE INDEX "idx_test_executions_project" ON "test_executions"("project_id");

-- CreateIndex
CREATE INDEX "idx_test_executions_run" ON "test_executions"("run_id");

-- CreateIndex
CREATE INDEX "idx_test_executions_case" ON "test_executions"("case_id");

-- AddForeignKey
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

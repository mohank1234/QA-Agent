-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "req_id" TEXT NOT NULL,
    "req_type" TEXT,
    "description" TEXT NOT NULL,
    "is_assumption" INTEGER NOT NULL DEFAULT 0,
    "source_document" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "requirement_ref" TEXT,
    "module" TEXT,
    "test_type" TEXT,
    "priority" TEXT,
    "severity" TEXT,
    "preconditions" TEXT,
    "steps" TEXT,
    "expected_result" TEXT,
    "test_data" TEXT,
    "source_requirement" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "benchmark_rows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "s_no" INTEGER,
    "agent" TEXT,
    "question" TEXT NOT NULL,
    "query_category" TEXT,
    "scenario_type" TEXT,
    "expected_answer" TEXT,
    "answer_in_testing" TEXT,
    "score" REAL,
    "source_document" TEXT,
    "notes" TEXT,
    "pass_fail" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "bug_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "steps_to_reproduce" TEXT,
    "expected_result" TEXT,
    "actual_result" TEXT,
    "severity" TEXT,
    "priority" TEXT,
    "environment" TEXT,
    "root_cause_suggestion" TEXT,
    "source_test_case" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "documents_json" TEXT
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_documents_project" ON "documents"("project_id");

-- CreateIndex
CREATE INDEX "idx_requirements_project" ON "requirements"("project_id");

-- CreateIndex
CREATE INDEX "idx_test_cases_project" ON "test_cases"("project_id");

-- CreateIndex
CREATE INDEX "idx_benchmark_rows_project" ON "benchmark_rows"("project_id");

-- CreateIndex
CREATE INDEX "idx_bug_reports_project" ON "bug_reports"("project_id");

-- CreateIndex
CREATE INDEX "idx_messages_project" ON "messages"("project_id");

-- CreateIndex
CREATE INDEX "idx_generated_documents_project" ON "generated_documents"("project_id");


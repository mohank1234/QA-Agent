-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "password_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_benchmark_rows" (
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
INSERT INTO "new_benchmark_rows" ("agent", "answer_in_testing", "created_at", "expected_answer", "id", "notes", "pass_fail", "project_id", "query_category", "question", "s_no", "scenario_type", "score", "source_document") SELECT "agent", "answer_in_testing", "created_at", "expected_answer", "id", "notes", "pass_fail", "project_id", "query_category", "question", "s_no", "scenario_type", "score", "source_document" FROM "benchmark_rows";
DROP TABLE "benchmark_rows";
ALTER TABLE "new_benchmark_rows" RENAME TO "benchmark_rows";
CREATE INDEX "idx_benchmark_rows_project" ON "benchmark_rows"("project_id");
CREATE TABLE "new_bug_reports" (
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
INSERT INTO "new_bug_reports" ("actual_result", "bug_id", "created_at", "description", "environment", "expected_result", "id", "priority", "project_id", "root_cause_suggestion", "severity", "source_test_case", "status", "steps_to_reproduce", "title") SELECT "actual_result", "bug_id", "created_at", "description", "environment", "expected_result", "id", "priority", "project_id", "root_cause_suggestion", "severity", "source_test_case", "status", "steps_to_reproduce", "title" FROM "bug_reports";
DROP TABLE "bug_reports";
ALTER TABLE "new_bug_reports" RENAME TO "bug_reports";
CREATE INDEX "idx_bug_reports_project" ON "bug_reports"("project_id");
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TEXT NOT NULL
);
INSERT INTO "new_documents" ("file_path", "filename", "id", "project_id", "uploaded_at") SELECT "file_path", "filename", "id", "project_id", "uploaded_at" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE INDEX "idx_documents_project" ON "documents"("project_id");
CREATE TABLE "new_generated_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL
);
INSERT INTO "new_generated_documents" ("content", "created_at", "doc_type", "filename", "id", "project_id", "title") SELECT "content", "created_at", "doc_type", "filename", "id", "project_id", "title" FROM "generated_documents";
DROP TABLE "generated_documents";
ALTER TABLE "new_generated_documents" RENAME TO "generated_documents";
CREATE INDEX "idx_generated_documents_project" ON "generated_documents"("project_id");
CREATE TABLE "new_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "documents_json" TEXT
);
INSERT INTO "new_messages" ("content", "created_at", "documents_json", "id", "project_id", "role") SELECT "content", "created_at", "documents_json", "id", "project_id", "role" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE INDEX "idx_messages_project" ON "messages"("project_id");
CREATE TABLE "new_projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TEXT NOT NULL
);
INSERT INTO "new_projects" ("created_at", "id", "name", "session_id") SELECT "created_at", "id", "name", "session_id" FROM "projects";
DROP TABLE "projects";
ALTER TABLE "new_projects" RENAME TO "projects";
CREATE TABLE "new_requirements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "req_id" TEXT NOT NULL,
    "req_type" TEXT,
    "description" TEXT NOT NULL,
    "is_assumption" INTEGER NOT NULL DEFAULT 0,
    "source_document" TEXT,
    "created_at" TEXT NOT NULL
);
INSERT INTO "new_requirements" ("created_at", "description", "id", "is_assumption", "project_id", "req_id", "req_type", "source_document") SELECT "created_at", "description", "id", "is_assumption", "project_id", "req_id", "req_type", "source_document" FROM "requirements";
DROP TABLE "requirements";
ALTER TABLE "new_requirements" RENAME TO "requirements";
CREATE INDEX "idx_requirements_project" ON "requirements"("project_id");
CREATE TABLE "new_test_cases" (
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
INSERT INTO "new_test_cases" ("case_id", "created_at", "expected_result", "id", "module", "preconditions", "priority", "project_id", "requirement_ref", "severity", "source_requirement", "steps", "test_data", "test_type") SELECT "case_id", "created_at", "expected_result", "id", "module", "preconditions", "priority", "project_id", "requirement_ref", "severity", "source_requirement", "steps", "test_data", "test_type" FROM "test_cases";
DROP TABLE "test_cases";
ALTER TABLE "new_test_cases" RENAME TO "test_cases";
CREATE INDEX "idx_test_cases_project" ON "test_cases"("project_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_password_reset_tokens_user" ON "password_reset_tokens"("user_id");


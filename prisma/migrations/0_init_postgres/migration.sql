-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TEXT NOT NULL,
    "owner_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "guest_id" TEXT,
    "expires_at" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TEXT NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "req_id" TEXT NOT NULL,
    "req_type" TEXT,
    "description" TEXT NOT NULL,
    "is_assumption" INTEGER NOT NULL DEFAULT 0,
    "source_document" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL,
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
    "created_at" TEXT NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_rows" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "s_no" INTEGER,
    "agent" TEXT,
    "question" TEXT NOT NULL,
    "query_category" TEXT,
    "scenario_type" TEXT,
    "expected_answer" TEXT,
    "answer_in_testing" TEXT,
    "score" DOUBLE PRECISION,
    "source_document" TEXT,
    "notes" TEXT,
    "pass_fail" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "benchmark_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL,
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
    "created_at" TEXT NOT NULL,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "documents_json" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_projects_owner" ON "projects"("owner_id");

-- CreateIndex
CREATE INDEX "idx_projects_guest" ON "projects"("guest_id");

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

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { DB_PATH } from "./paths";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      req_id TEXT NOT NULL,
      req_type TEXT,
      description TEXT NOT NULL,
      is_assumption INTEGER NOT NULL DEFAULT 0,
      source_document TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      requirement_ref TEXT,
      module TEXT,
      test_type TEXT,
      priority TEXT,
      severity TEXT,
      preconditions TEXT,
      steps TEXT,
      expected_result TEXT,
      test_data TEXT,
      source_requirement TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS benchmark_rows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      s_no INTEGER,
      agent TEXT,
      question TEXT NOT NULL,
      query_category TEXT,
      scenario_type TEXT,
      expected_answer TEXT,
      answer_in_testing TEXT,
      score REAL,
      source_document TEXT,
      notes TEXT,
      pass_fail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      bug_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      steps_to_reproduce TEXT,
      expected_result TEXT,
      actual_result TEXT,
      severity TEXT,
      priority TEXT,
      environment TEXT,
      root_cause_suggestion TEXT,
      source_test_case TEXT,
      status TEXT NOT NULL DEFAULT 'Open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
    CREATE INDEX IF NOT EXISTS idx_test_cases_project ON test_cases(project_id);
    CREATE INDEX IF NOT EXISTS idx_benchmark_rows_project ON benchmark_rows(project_id);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_project ON bug_reports(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_generated_documents_project ON generated_documents(project_id);
  `);

  const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!messageColumns.some((c) => c.name === "documents_json")) {
    db.exec("ALTER TABLE messages ADD COLUMN documents_json TEXT");
  }

  return db;
}

export type Project = {
  id: string;
  name: string;
  session_id: string | null;
  created_at: string;
};

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all();
  return rows as unknown as Project[];
}

export function createProject(name: string): Project {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, session_id, created_at) VALUES (?, ?, NULL, ?)"
    )
    .run(id, name, created_at);
  return { id, name, session_id: null, created_at };
}

export function getProject(id: string): Project | undefined {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row as unknown as Project | undefined;
}

export function setProjectSessionId(projectId: string, sessionId: string) {
  getDb()
    .prepare("UPDATE projects SET session_id = ? WHERE id = ?")
    .run(sessionId, projectId);
}

export function deleteProject(id: string) {
  const dbi = getDb();
  for (const table of [
    "documents",
    "messages",
    "requirements",
    "test_cases",
    "benchmark_rows",
    "bug_reports",
    "generated_documents",
  ]) {
    dbi.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(id);
  }
  dbi.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function saveGeneratedDocument(
  projectId: string,
  title: string,
  docType: string,
  filename: string,
  content: string
) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO generated_documents (id, project_id, title, doc_type, filename, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, projectId, title, docType, filename, content, createdAt);
  return { id, createdAt };
}

export function listGeneratedDocuments(projectId: string) {
  return getDb()
    .prepare(
      "SELECT id, title, doc_type, filename, created_at FROM generated_documents WHERE project_id = ? ORDER BY created_at DESC"
    )
    .all(projectId);
}

export function getGeneratedDocumentContent(projectId: string, filename: string): string | undefined {
  const row = getDb()
    .prepare("SELECT content FROM generated_documents WHERE project_id = ? AND filename = ?")
    .get(projectId, filename) as { content: string } | undefined;
  return row?.content;
}

export type MessageDocument = {
  title: string;
  docType: string;
  previewUrl: string;
  downloadUrl: string;
};

export function addMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  documents?: MessageDocument[]
) {
  getDb()
    .prepare(
      "INSERT INTO messages (id, project_id, role, content, documents_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      randomUUID(),
      projectId,
      role,
      content,
      documents && documents.length > 0 ? JSON.stringify(documents) : null,
      new Date().toISOString()
    );
}

export function listMessages(projectId: string) {
  const rows = getDb()
    .prepare(
      "SELECT role, content, documents_json, created_at FROM messages WHERE project_id = ? ORDER BY created_at ASC"
    )
    .all(projectId) as {
    role: string;
    content: string;
    documents_json: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at,
    documents: r.documents_json ? (JSON.parse(r.documents_json) as MessageDocument[]) : [],
  }));
}

export function addDocument(projectId: string, filename: string, filePath: string) {
  const dbi = getDb();
  const uploadedAt = new Date().toISOString();
  const existing = dbi
    .prepare("SELECT id FROM documents WHERE project_id = ? AND filename = ?")
    .get(projectId, filename) as { id: string } | undefined;

  if (existing) {
    dbi
      .prepare("UPDATE documents SET file_path = ?, uploaded_at = ? WHERE id = ?")
      .run(filePath, uploadedAt, existing.id);
    return { id: existing.id, uploadedAt };
  }

  const id = randomUUID();
  dbi
    .prepare(
      "INSERT INTO documents (id, project_id, filename, file_path, uploaded_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, projectId, filename, filePath, uploadedAt);
  return { id, uploadedAt };
}

export function listDocuments(projectId: string) {
  return getDb()
    .prepare(
      "SELECT id, filename, file_path, uploaded_at FROM documents WHERE project_id = ? ORDER BY uploaded_at ASC"
    )
    .all(projectId);
}

export type RequirementInput = {
  reqId: string;
  reqType?: string;
  description: string;
  isAssumption?: boolean;
  sourceDocument?: string;
};

export function insertRequirement(projectId: string, r: RequirementInput) {
  getDb()
    .prepare(
      `INSERT INTO requirements (id, project_id, req_id, req_type, description, is_assumption, source_document, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      projectId,
      r.reqId,
      r.reqType ?? null,
      r.description,
      r.isAssumption ? 1 : 0,
      r.sourceDocument ?? null,
      new Date().toISOString()
    );
}

export function listRequirementsForProject(projectId: string) {
  return getDb()
    .prepare(
      "SELECT req_id, req_type, description, is_assumption, source_document FROM requirements WHERE project_id = ? ORDER BY req_id"
    )
    .all(projectId);
}

export type TestCaseInput = {
  caseId: string;
  sourceRequirement?: string;
  module?: string;
  testType?: string;
  priority?: string;
  severity?: string;
  preconditions?: string;
  steps: string;
  expectedResult: string;
  testData?: string;
};

export function insertTestCase(projectId: string, t: TestCaseInput) {
  getDb()
    .prepare(
      `INSERT INTO test_cases (id, project_id, case_id, requirement_ref, module, test_type, priority, severity, preconditions, steps, expected_result, test_data, source_requirement, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      projectId,
      t.caseId,
      t.sourceRequirement ?? null,
      t.module ?? null,
      t.testType ?? null,
      t.priority ?? null,
      t.severity ?? null,
      t.preconditions ?? null,
      t.steps,
      t.expectedResult,
      t.testData ?? null,
      t.sourceRequirement ?? null,
      new Date().toISOString()
    );
}

export function listTestCasesForProject(projectId: string) {
  return getDb()
    .prepare(
      `SELECT case_id, source_requirement, module, test_type, priority, severity, preconditions, steps, expected_result, test_data
       FROM test_cases WHERE project_id = ? ORDER BY case_id`
    )
    .all(projectId);
}

export type BenchmarkRowInput = {
  sNo?: number;
  agent?: string;
  question: string;
  queryCategory?: string;
  scenarioType?: string;
  expectedAnswer?: string;
  answerInTesting?: string;
  score?: number;
  sourceDocument?: string;
  notes?: string;
  passFail?: string;
};

export function insertBenchmarkRow(projectId: string, b: BenchmarkRowInput) {
  getDb()
    .prepare(
      `INSERT INTO benchmark_rows (id, project_id, s_no, agent, question, query_category, scenario_type, expected_answer, answer_in_testing, score, source_document, notes, pass_fail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      projectId,
      b.sNo ?? null,
      b.agent ?? null,
      b.question,
      b.queryCategory ?? null,
      b.scenarioType ?? null,
      b.expectedAnswer ?? null,
      b.answerInTesting ?? null,
      b.score ?? null,
      b.sourceDocument ?? null,
      b.notes ?? null,
      b.passFail ?? null,
      new Date().toISOString()
    );
}

export function listBenchmarkRowsForProject(projectId: string) {
  return getDb()
    .prepare(
      `SELECT s_no, agent, question, query_category, scenario_type, expected_answer, answer_in_testing, score, source_document, notes, pass_fail
       FROM benchmark_rows WHERE project_id = ? ORDER BY s_no`
    )
    .all(projectId);
}

export type BugReportInput = {
  bugId: string;
  title: string;
  description?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  severity?: string;
  priority?: string;
  environment?: string;
  rootCauseSuggestion?: string;
  sourceTestCase?: string;
  status?: string;
};

export function insertBugReport(projectId: string, b: BugReportInput) {
  getDb()
    .prepare(
      `INSERT INTO bug_reports (id, project_id, bug_id, title, description, steps_to_reproduce, expected_result, actual_result, severity, priority, environment, root_cause_suggestion, source_test_case, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      projectId,
      b.bugId,
      b.title,
      b.description ?? null,
      b.stepsToReproduce ?? null,
      b.expectedResult ?? null,
      b.actualResult ?? null,
      b.severity ?? null,
      b.priority ?? null,
      b.environment ?? null,
      b.rootCauseSuggestion ?? null,
      b.sourceTestCase ?? null,
      b.status ?? "Open",
      new Date().toISOString()
    );
}

export function listBugReportsForProject(projectId: string) {
  return getDb()
    .prepare(
      `SELECT bug_id, title, description, steps_to_reproduce, expected_result, actual_result, severity, priority, environment, root_cause_suggestion, source_test_case, status
       FROM bug_reports WHERE project_id = ? ORDER BY bug_id`
    )
    .all(projectId);
}

export type ProjectStats = {
  requirementCount: number;
  assumptionCount: number;
  testCaseCount: number;
  requirementsWithTestCases: number;
  bugCount: number;
  bugsByStatus: Record<string, number>;
  bugsBySeverity: Record<string, number>;
  benchmarkRowCount: number;
  benchmarkPassCount: number;
  benchmarkFailCount: number;
  benchmarkAvgScore: number | null;
};

export function computeProjectStats(projectId: string): ProjectStats {
  const db = getDb();

  const requirementCount = (
    db.prepare("SELECT COUNT(*) AS c FROM requirements WHERE project_id = ?").get(projectId) as {
      c: number;
    }
  ).c;
  const assumptionCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM requirements WHERE project_id = ? AND is_assumption = 1"
      )
      .get(projectId) as { c: number }
  ).c;
  const testCaseCount = (
    db.prepare("SELECT COUNT(*) AS c FROM test_cases WHERE project_id = ?").get(projectId) as {
      c: number;
    }
  ).c;
  const requirementsWithTestCases = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT req_id) AS c FROM requirements
         WHERE project_id = ? AND req_id IN (
           SELECT source_requirement FROM test_cases WHERE project_id = ? AND source_requirement IS NOT NULL
         )`
      )
      .get(projectId, projectId) as { c: number }
  ).c;
  const bugCount = (
    db.prepare("SELECT COUNT(*) AS c FROM bug_reports WHERE project_id = ?").get(projectId) as {
      c: number;
    }
  ).c;
  const bugsByStatusRows = db
    .prepare("SELECT status, COUNT(*) AS c FROM bug_reports WHERE project_id = ? GROUP BY status")
    .all(projectId) as { status: string; c: number }[];
  const bugsBySeverityRows = db
    .prepare(
      "SELECT COALESCE(severity, 'Unspecified') AS severity, COUNT(*) AS c FROM bug_reports WHERE project_id = ? GROUP BY severity"
    )
    .all(projectId) as { severity: string; c: number }[];
  const benchmarkRowCount = (
    db.prepare("SELECT COUNT(*) AS c FROM benchmark_rows WHERE project_id = ?").get(projectId) as {
      c: number;
    }
  ).c;
  const benchmarkPassCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM benchmark_rows WHERE project_id = ? AND pass_fail = 'Pass'"
      )
      .get(projectId) as { c: number }
  ).c;
  const benchmarkFailCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM benchmark_rows WHERE project_id = ? AND pass_fail = 'Fail'"
      )
      .get(projectId) as { c: number }
  ).c;
  const benchmarkAvgScoreRow = db
    .prepare("SELECT AVG(score) AS avg_score FROM benchmark_rows WHERE project_id = ?")
    .get(projectId) as { avg_score: number | null };

  return {
    requirementCount,
    assumptionCount,
    testCaseCount,
    requirementsWithTestCases,
    bugCount,
    bugsByStatus: Object.fromEntries(bugsByStatusRows.map((r) => [r.status, r.c])),
    bugsBySeverity: Object.fromEntries(bugsBySeverityRows.map((r) => [r.severity, r.c])),
    benchmarkRowCount,
    benchmarkPassCount,
    benchmarkFailCount,
    benchmarkAvgScore: benchmarkAvgScoreRow.avg_score,
  };
}

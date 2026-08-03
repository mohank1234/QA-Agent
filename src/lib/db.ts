import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";

// Every function here is now async (Prisma, unlike the node:sqlite this
// replaced, has no synchronous API) — every caller across agentTools.ts,
// agent.ts, auth.ts, apiAuth.ts, projectCleanup.ts, and the API routes needs
// `await` on these. See docs/BUILD_JOURNAL.md for why this moved off SQLite.

export type Project = {
  id: string;
  name: string;
  session_id: string | null;
  created_at: string;
  owner_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  guest_id: string | null;
  expires_at: string | null;
};

function toProject(row: {
  id: string;
  name: string;
  sessionId: string | null;
  createdAt: string;
  ownerId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  guestId: string | null;
  expiresAt: string | null;
}): Project {
  return {
    id: row.id,
    name: row.name,
    session_id: row.sessionId,
    created_at: row.createdAt,
    owner_id: row.ownerId,
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    guest_id: row.guestId,
    expires_at: row.expiresAt,
  };
}

export const GUEST_PROJECT_TTL_MS = 60 * 60 * 1000; // 1 hour

export type ProjectIdentity = { userId: string } | { guestId: string };

export async function listProjects(identity: ProjectIdentity): Promise<Project[]> {
  if ("userId" in identity) {
    const rows = await prisma.project.findMany({
      where: { ownerId: identity.userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toProject);
  }
  // Guests only ever see their own not-yet-expired projects — an expired row
  // still physically exists for a few minutes until the cleanup sweep runs,
  // but should never be listed as usable in that window.
  const now = new Date().toISOString();
  const rows = await prisma.project.findMany({
    where: { guestId: identity.guestId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toProject);
}

export async function createProject(name: string, identity: ProjectIdentity): Promise<Project> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const isGuest = "guestId" in identity;
  const ownerId = isGuest ? null : identity.userId;
  const guestId = isGuest ? identity.guestId : null;
  const createdBy = isGuest ? null : identity.userId;
  const updatedBy = createdBy;
  const expiresAt = isGuest ? new Date(Date.now() + GUEST_PROJECT_TTL_MS).toISOString() : null;

  const row = await prisma.project.create({
    data: { id, name, createdAt, ownerId, createdBy, updatedBy, guestId, expiresAt },
  });
  return toProject(row);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const row = await prisma.project.findUnique({ where: { id } });
  return row ? toProject(row) : undefined;
}

export function isProjectExpired(project: Project): boolean {
  return project.expires_at !== null && project.expires_at <= new Date().toISOString();
}

// One-time backfill for projects created before auth existed (ownerId AND
// guestId both null). The guestId: null clause matters: without it, this
// would also sweep up active anonymous-session projects that simply haven't
// expired yet, which is not what "orphaned" means here. Only ever claims for
// the very first user account on this instance — see callers — so a
// second/third signup on a real multi-user deployment never inherits
// someone else's pre-existing data. (createdBy is always null on rows this
// matches — every insert path sets ownerId/createdBy together or not at all
// — so a plain assignment here is equivalent to the original SQL's
// COALESCE(created_by, ?), not a behavior change.)
export async function claimOrphanedProjects(userId: string): Promise<void> {
  await prisma.project.updateMany({
    where: { ownerId: null, guestId: null },
    data: { ownerId: userId, createdBy: userId, updatedBy: userId },
  });
}

// A guest who signs up/in gets their in-progress anonymous work instead of
// losing it — the whole point of the "if login, stays in your profile"
// requirement. Only converts rows still matching this exact guestId cookie;
// already-expired-and-swept rows are gone by the time this runs and there's
// nothing to claim. (Same createdBy reasoning as claimOrphanedProjects above
// — guest-created rows never have a pre-existing createdBy.)
export async function claimGuestProjects(guestId: string, userId: string): Promise<void> {
  await prisma.project.updateMany({
    where: { guestId },
    data: { ownerId: userId, createdBy: userId, updatedBy: userId, guestId: null, expiresAt: null },
  });
}

export async function listExpiredGuestProjectIds(): Promise<string[]> {
  const now = new Date().toISOString();
  const rows = await prisma.project.findMany({
    where: { expiresAt: { not: null, lte: now } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function setProjectSessionId(projectId: string, sessionId: string): Promise<void> {
  await prisma.project.update({ where: { id: projectId }, data: { sessionId } });
}

export async function deleteProject(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.document.deleteMany({ where: { projectId: id } }),
    prisma.message.deleteMany({ where: { projectId: id } }),
    prisma.requirement.deleteMany({ where: { projectId: id } }),
    prisma.testCase.deleteMany({ where: { projectId: id } }),
    prisma.benchmarkRow.deleteMany({ where: { projectId: id } }),
    prisma.bugReport.deleteMany({ where: { projectId: id } }),
    prisma.generatedDocument.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);
}

export async function saveGeneratedDocument(
  projectId: string,
  title: string,
  docType: string,
  filename: string,
  content: string
) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await prisma.generatedDocument.create({
    data: { id, projectId, title, docType, filename, content, createdAt },
  });
  return { id, createdAt };
}

export async function listGeneratedDocuments(projectId: string) {
  const rows = await prisma.generatedDocument.findMany({
    where: { projectId },
    select: { id: true, title: true, docType: true, filename: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    doc_type: r.docType,
    filename: r.filename,
    created_at: r.createdAt,
  }));
}

export async function getGeneratedDocumentContent(
  projectId: string,
  filename: string
): Promise<string | undefined> {
  const row = await prisma.generatedDocument.findFirst({
    where: { projectId, filename },
    select: { content: true },
  });
  return row?.content;
}

export type MessageDocument = {
  title: string;
  docType: string;
  previewUrl: string;
  downloadUrl: string;
};

export async function addMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  documents?: MessageDocument[]
): Promise<void> {
  await prisma.message.create({
    data: {
      id: randomUUID(),
      projectId,
      role,
      content,
      documentsJson: documents && documents.length > 0 ? JSON.stringify(documents) : null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listMessages(projectId: string) {
  const rows = await prisma.message.findMany({
    where: { projectId },
    select: { role: true, content: true, documentsJson: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.createdAt,
    documents: r.documentsJson ? (JSON.parse(r.documentsJson) as MessageDocument[]) : [],
  }));
}

export async function addDocument(projectId: string, filename: string, filePath: string) {
  const uploadedAt = new Date().toISOString();
  const existing = await prisma.document.findFirst({
    where: { projectId, filename },
    select: { id: true },
  });

  if (existing) {
    await prisma.document.update({
      where: { id: existing.id },
      data: { filePath, uploadedAt },
    });
    return { id: existing.id, uploadedAt };
  }

  const id = randomUUID();
  await prisma.document.create({ data: { id, projectId, filename, filePath, uploadedAt } });
  return { id, uploadedAt };
}

export async function listDocuments(projectId: string) {
  const rows = await prisma.document.findMany({
    where: { projectId },
    select: { id: true, filename: true, filePath: true, uploadedAt: true },
    orderBy: { uploadedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    file_path: r.filePath,
    uploaded_at: r.uploadedAt,
  }));
}

export type RequirementInput = {
  reqId: string;
  reqType?: string;
  description: string;
  isAssumption?: boolean;
  sourceDocument?: string;
};

export async function insertRequirement(projectId: string, r: RequirementInput): Promise<void> {
  await prisma.requirement.create({
    data: {
      id: randomUUID(),
      projectId,
      reqId: r.reqId,
      reqType: r.reqType ?? null,
      description: r.description,
      isAssumption: r.isAssumption ? 1 : 0,
      sourceDocument: r.sourceDocument ?? null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listRequirementsForProject(projectId: string) {
  const rows = await prisma.requirement.findMany({
    where: { projectId },
    select: { reqId: true, reqType: true, description: true, isAssumption: true, sourceDocument: true },
    orderBy: { reqId: "asc" },
  });
  return rows.map((r) => ({
    req_id: r.reqId,
    req_type: r.reqType,
    description: r.description,
    is_assumption: r.isAssumption,
    source_document: r.sourceDocument,
  }));
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

export async function insertTestCase(projectId: string, t: TestCaseInput): Promise<void> {
  await prisma.testCase.create({
    data: {
      id: randomUUID(),
      projectId,
      caseId: t.caseId,
      requirementRef: t.sourceRequirement ?? null,
      module: t.module ?? null,
      testType: t.testType ?? null,
      priority: t.priority ?? null,
      severity: t.severity ?? null,
      preconditions: t.preconditions ?? null,
      steps: t.steps,
      expectedResult: t.expectedResult,
      testData: t.testData ?? null,
      sourceRequirement: t.sourceRequirement ?? null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listTestCasesForProject(projectId: string) {
  const rows = await prisma.testCase.findMany({
    where: { projectId },
    select: {
      caseId: true,
      sourceRequirement: true,
      module: true,
      testType: true,
      priority: true,
      severity: true,
      preconditions: true,
      steps: true,
      expectedResult: true,
      testData: true,
    },
    orderBy: { caseId: "asc" },
  });
  return rows.map((r) => ({
    case_id: r.caseId,
    source_requirement: r.sourceRequirement,
    module: r.module,
    test_type: r.testType,
    priority: r.priority,
    severity: r.severity,
    preconditions: r.preconditions,
    steps: r.steps,
    expected_result: r.expectedResult,
    test_data: r.testData,
  }));
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

export async function insertBenchmarkRow(projectId: string, b: BenchmarkRowInput): Promise<void> {
  await prisma.benchmarkRow.create({
    data: {
      id: randomUUID(),
      projectId,
      sNo: b.sNo ?? null,
      agent: b.agent ?? null,
      question: b.question,
      queryCategory: b.queryCategory ?? null,
      scenarioType: b.scenarioType ?? null,
      expectedAnswer: b.expectedAnswer ?? null,
      answerInTesting: b.answerInTesting ?? null,
      score: b.score ?? null,
      sourceDocument: b.sourceDocument ?? null,
      notes: b.notes ?? null,
      passFail: b.passFail ?? null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listBenchmarkRowsForProject(projectId: string) {
  const rows = await prisma.benchmarkRow.findMany({
    where: { projectId },
    select: {
      sNo: true,
      agent: true,
      question: true,
      queryCategory: true,
      scenarioType: true,
      expectedAnswer: true,
      answerInTesting: true,
      score: true,
      sourceDocument: true,
      notes: true,
      passFail: true,
    },
    orderBy: { sNo: "asc" },
  });
  return rows.map((r) => ({
    s_no: r.sNo,
    agent: r.agent,
    question: r.question,
    query_category: r.queryCategory,
    scenario_type: r.scenarioType,
    expected_answer: r.expectedAnswer,
    answer_in_testing: r.answerInTesting,
    score: r.score,
    source_document: r.sourceDocument,
    notes: r.notes,
    pass_fail: r.passFail,
  }));
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

export async function insertBugReport(projectId: string, b: BugReportInput): Promise<void> {
  await prisma.bugReport.create({
    data: {
      id: randomUUID(),
      projectId,
      bugId: b.bugId,
      title: b.title,
      description: b.description ?? null,
      stepsToReproduce: b.stepsToReproduce ?? null,
      expectedResult: b.expectedResult ?? null,
      actualResult: b.actualResult ?? null,
      severity: b.severity ?? null,
      priority: b.priority ?? null,
      environment: b.environment ?? null,
      rootCauseSuggestion: b.rootCauseSuggestion ?? null,
      sourceTestCase: b.sourceTestCase ?? null,
      status: b.status ?? "Open",
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listBugReportsForProject(projectId: string) {
  const rows = await prisma.bugReport.findMany({
    where: { projectId },
    select: {
      bugId: true,
      title: true,
      description: true,
      stepsToReproduce: true,
      expectedResult: true,
      actualResult: true,
      severity: true,
      priority: true,
      environment: true,
      rootCauseSuggestion: true,
      sourceTestCase: true,
      status: true,
    },
    orderBy: { bugId: "asc" },
  });
  return rows.map((r) => ({
    bug_id: r.bugId,
    title: r.title,
    description: r.description,
    steps_to_reproduce: r.stepsToReproduce,
    expected_result: r.expectedResult,
    actual_result: r.actualResult,
    severity: r.severity,
    priority: r.priority,
    environment: r.environment,
    root_cause_suggestion: r.rootCauseSuggestion,
    source_test_case: r.sourceTestCase,
    status: r.status,
  }));
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

export async function computeProjectStats(projectId: string): Promise<ProjectStats> {
  const [
    requirementCount,
    assumptionCount,
    testCaseCount,
    testCaseSourceRefs,
    bugCount,
    bugsByStatusRows,
    bugsBySeverityRows,
    benchmarkRowCount,
    benchmarkPassCount,
    benchmarkFailCount,
    benchmarkAvg,
  ] = await Promise.all([
    prisma.requirement.count({ where: { projectId } }),
    prisma.requirement.count({ where: { projectId, isAssumption: 1 } }),
    prisma.testCase.count({ where: { projectId } }),
    prisma.testCase.findMany({
      where: { projectId, sourceRequirement: { not: null } },
      select: { sourceRequirement: true },
      distinct: ["sourceRequirement"],
    }),
    prisma.bugReport.count({ where: { projectId } }),
    prisma.bugReport.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.bugReport.groupBy({ by: ["severity"], where: { projectId }, _count: { _all: true } }),
    prisma.benchmarkRow.count({ where: { projectId } }),
    prisma.benchmarkRow.count({ where: { projectId, passFail: "Pass" } }),
    prisma.benchmarkRow.count({ where: { projectId, passFail: "Fail" } }),
    prisma.benchmarkRow.aggregate({ where: { projectId }, _avg: { score: true } }),
  ]);

  // Distinct requirement IDs referenced by at least one test case in this
  // project — equivalent to the original SQL's
  // `req_id IN (SELECT source_requirement FROM test_cases WHERE ...)`.
  const referencedReqIds = testCaseSourceRefs
    .map((r) => r.sourceRequirement)
    .filter((v): v is string => v !== null);
  const requirementsWithTestCases =
    referencedReqIds.length === 0
      ? 0
      : await prisma.requirement.count({ where: { projectId, reqId: { in: referencedReqIds } } });

  const bugsBySeverity: Record<string, number> = {};
  for (const row of bugsBySeverityRows) {
    const key = row.severity ?? "Unspecified";
    bugsBySeverity[key] = (bugsBySeverity[key] ?? 0) + row._count._all;
  }

  return {
    requirementCount,
    assumptionCount,
    testCaseCount,
    requirementsWithTestCases,
    bugCount,
    bugsByStatus: Object.fromEntries(bugsByStatusRows.map((r) => [r.status, r._count._all])),
    bugsBySeverity,
    benchmarkRowCount,
    benchmarkPassCount,
    benchmarkFailCount,
    benchmarkAvgScore: benchmarkAvg._avg.score,
  };
}

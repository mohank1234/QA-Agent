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

// The date columns are DateTime in the schema now, so Prisma hands back Date
// objects here. Everything downstream of this module — the API routes,
// page.tsx, the exporters — has always consumed ISO strings, so every mapper
// in this file converts on the way out and the public shapes below stay
// exactly as they were.
function toProject(row: {
  id: string;
  name: string;
  sessionId: string | null;
  createdAt: Date;
  ownerId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  guestId: string | null;
  expiresAt: Date | null;
}): Project {
  return {
    id: row.id,
    name: row.name,
    session_id: row.sessionId,
    created_at: row.createdAt.toISOString(),
    owner_id: row.ownerId,
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    guest_id: row.guestId,
    expires_at: row.expiresAt?.toISOString() ?? null,
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
    // Execution tables. Executions go before runs: the FK between them
    // cascades, but deleting them explicitly first also catches any row whose
    // run was already gone, and keeps this list readable as "everything
    // belonging to this project" rather than relying on delete order.
    prisma.testExecution.deleteMany({ where: { projectId: id } }),
    prisma.testRun.deleteMany({ where: { projectId: id } }),
    prisma.testScript.deleteMany({ where: { projectId: id } }),
    prisma.testScenario.deleteMany({ where: { projectId: id } }),
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
    created_at: r.createdAt.toISOString(),
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
    created_at: r.createdAt.toISOString(),
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
    uploaded_at: r.uploadedAt.toISOString(),
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
  scenarioRef?: string;
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
      scenarioRef: t.scenarioRef ?? null,
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
      scenarioRef: true,
      actualResult: true,
      status: true,
      comments: true,
      lastExecutedAt: true,
    },
    orderBy: { caseId: "asc" },
  });
  return rows.map((r) => ({
    case_id: r.caseId,
    source_requirement: r.sourceRequirement,
    scenario_ref: r.scenarioRef,
    module: r.module,
    test_type: r.testType,
    priority: r.priority,
    severity: r.severity,
    preconditions: r.preconditions,
    steps: r.steps,
    expected_result: r.expectedResult,
    test_data: r.testData,
    // Execution output. status stays null until something actually runs this
    // case, which is what distinguishes "not run" from "run and passed".
    actual_result: r.actualResult,
    status: r.status,
    comments: r.comments,
    last_executed_at: r.lastExecutedAt?.toISOString() ?? null,
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
  module?: string;
  description?: string;
  preconditions?: string;
  testData?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  severity?: string;
  priority?: string;
  frequency?: string;
  environment?: string;
  rootCauseSuggestion?: string;
  sourceTestCase?: string;
  comments?: string;
  status?: string;
  // Not exposed to the agent's save_bug_reports tool — only the execution
  // path may set these, since attachments point at real captured evidence and
  // dateReported should reflect when a defect was actually observed.
  attachments?: { label: string; key: string }[];
  dateReported?: string;
};

export async function insertBugReport(projectId: string, b: BugReportInput): Promise<void> {
  const now = new Date().toISOString();
  await prisma.bugReport.create({
    data: {
      id: randomUUID(),
      projectId,
      bugId: b.bugId,
      title: b.title,
      module: b.module ?? null,
      description: b.description ?? null,
      preconditions: b.preconditions ?? null,
      testData: b.testData ?? null,
      stepsToReproduce: b.stepsToReproduce ?? null,
      expectedResult: b.expectedResult ?? null,
      actualResult: b.actualResult ?? null,
      severity: b.severity ?? null,
      priority: b.priority ?? null,
      frequency: b.frequency ?? null,
      environment: b.environment ?? null,
      rootCauseSuggestion: b.rootCauseSuggestion ?? null,
      sourceTestCase: b.sourceTestCase ?? null,
      comments: b.comments ?? null,
      status: b.status ?? "Open",
      attachmentsJson:
        b.attachments && b.attachments.length > 0 ? JSON.stringify(b.attachments) : null,
      // Defaults to now, so a bug filed by hand still has a real reported
      // date; the execution path passes the run's time instead.
      dateReported: b.dateReported ?? now,
      createdAt: now,
    },
  });
}

export async function listBugReportsForProject(projectId: string) {
  const rows = await prisma.bugReport.findMany({
    where: { projectId },
    select: {
      bugId: true,
      title: true,
      module: true,
      description: true,
      preconditions: true,
      testData: true,
      stepsToReproduce: true,
      expectedResult: true,
      actualResult: true,
      severity: true,
      priority: true,
      frequency: true,
      environment: true,
      rootCauseSuggestion: true,
      sourceTestCase: true,
      comments: true,
      status: true,
      attachmentsJson: true,
      dateReported: true,
    },
    orderBy: { bugId: "asc" },
  });
  return rows.map((r) => ({
    bug_id: r.bugId,
    title: r.title,
    module: r.module,
    description: r.description,
    preconditions: r.preconditions,
    test_data: r.testData,
    steps_to_reproduce: r.stepsToReproduce,
    expected_result: r.expectedResult,
    actual_result: r.actualResult,
    severity: r.severity,
    priority: r.priority,
    frequency: r.frequency,
    environment: r.environment,
    root_cause_suggestion: r.rootCauseSuggestion,
    source_test_case: r.sourceTestCase,
    comments: r.comments,
    status: r.status,
    attachments: r.attachmentsJson
      ? (JSON.parse(r.attachmentsJson) as { label: string; key: string }[])
      : [],
    date_reported: r.dateReported.toISOString(),
  }));
}

// --- Test scenarios -----------------------------------------------------

// --- Bug drafting and fix verification ---------------------------------

// Full record for one test case, used when drafting a bug from a failure:
// module, preconditions, test data, steps, and expected result all come from
// the case rather than being re-invented by the model.
export async function getTestCaseByCaseId(projectId: string, caseId: string) {
  return prisma.testCase.findFirst({ where: { projectId, caseId } });
}

export async function getBugByBugId(projectId: string, bugId: string) {
  return prisma.bugReport.findFirst({ where: { projectId, bugId } });
}

// Scripts that implement a given test case — what a re-run needs in order to
// execute the *same* test again rather than an approximation of it.
export async function getScriptsForCase(
  projectId: string,
  caseId: string
): Promise<StoredTestScript[]> {
  const rows = await prisma.testScript.findMany({
    where: { projectId, caseRef: caseId },
    orderBy: { scriptId: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    scriptId: r.scriptId,
    name: r.name,
    testType: r.testType,
    caseRef: r.caseRef,
    url: r.url,
    body: r.body,
    timeoutMs: r.timeoutMs,
    useSession: r.useSession,
    saveSession: r.saveSession,
  }));
}

// Next free BUG-nnn for this project. Derived from what's actually stored so
// two drafts in a row don't collide, and so a project that already has
// hand-written bug IDs continues the sequence instead of restarting it.
export async function nextBugId(projectId: string): Promise<string> {
  const rows = await prisma.bugReport.findMany({
    where: { projectId },
    select: { bugId: true },
  });
  let highest = 0;
  for (const { bugId } of rows) {
    const match = /(\d+)\s*$/.exec(bugId);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `BUG-${String(highest + 1).padStart(3, "0")}`;
}

export async function updateBugStatus(
  projectId: string,
  bugId: string,
  status: string,
  comments?: string
): Promise<number> {
  const { count } = await prisma.bugReport.updateMany({
    where: { projectId, bugId },
    data: { status, ...(comments !== undefined ? { comments } : {}) },
  });
  return count;
}

export type TestScenarioInput = {
  scenarioId: string;
  scenario: string;
  priority?: string;
  sourceRequirement?: string;
};

export async function insertTestScenario(
  projectId: string,
  s: TestScenarioInput
): Promise<void> {
  await prisma.testScenario.create({
    data: {
      id: randomUUID(),
      projectId,
      scenarioId: s.scenarioId,
      scenario: s.scenario,
      priority: s.priority ?? null,
      sourceRequirement: s.sourceRequirement ?? null,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function listTestScenariosForProject(projectId: string) {
  const rows = await prisma.testScenario.findMany({
    where: { projectId },
    select: {
      scenarioId: true,
      scenario: true,
      priority: true,
      sourceRequirement: true,
    },
    orderBy: { scenarioId: "asc" },
  });
  return rows.map((r) => ({
    scenario_id: r.scenarioId,
    scenario: r.scenario,
    priority: r.priority,
    source_requirement: r.sourceRequirement,
  }));
}

// --- Test scripts -------------------------------------------------------

export type TestScriptInput = {
  scriptId: string;
  name: string;
  testType: "browser" | "api";
  caseRef?: string;
  url?: string;
  body: string;
  timeoutMs?: number;
  useSession?: string;
  saveSession?: string;
};

// Upsert on (projectId, scriptId) rather than insert: the agent iterating on a
// script should replace it, not accumulate near-duplicate versions that a
// suite run would then execute all of. scriptId is not DB-unique (no
// constraint exists on these tables by convention), so this is a
// findFirst-then-update/create rather than prisma.upsert.
export async function saveTestScript(
  projectId: string,
  s: TestScriptInput
): Promise<{ id: string; created: boolean }> {
  const now = new Date().toISOString();
  const existing = await prisma.testScript.findFirst({
    where: { projectId, scriptId: s.scriptId },
    select: { id: true },
  });

  if (existing) {
    await prisma.testScript.update({
      where: { id: existing.id },
      data: {
        name: s.name,
        testType: s.testType,
        caseRef: s.caseRef ?? null,
        url: s.url ?? null,
        body: s.body,
        timeoutMs: s.timeoutMs ?? null,
        useSession: s.useSession ?? null,
        saveSession: s.saveSession ?? null,
        updatedAt: now,
      },
    });
    return { id: existing.id, created: false };
  }

  const id = randomUUID();
  await prisma.testScript.create({
    data: {
      id,
      projectId,
      scriptId: s.scriptId,
      name: s.name,
      testType: s.testType,
      caseRef: s.caseRef ?? null,
      url: s.url ?? null,
      body: s.body,
      timeoutMs: s.timeoutMs ?? null,
      useSession: s.useSession ?? null,
      saveSession: s.saveSession ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, created: true };
}

export async function listTestScripts(projectId: string) {
  const rows = await prisma.testScript.findMany({
    where: { projectId },
    select: {
      scriptId: true,
      name: true,
      testType: true,
      caseRef: true,
      url: true,
      timeoutMs: true,
      useSession: true,
      saveSession: true,
      updatedAt: true,
    },
    orderBy: { scriptId: "asc" },
  });
  return rows.map((r) => ({
    script_id: r.scriptId,
    name: r.name,
    test_type: r.testType,
    case_ref: r.caseRef,
    url: r.url,
    timeout_ms: r.timeoutMs,
    use_session: r.useSession,
    save_session: r.saveSession,
    updated_at: r.updatedAt.toISOString(),
  }));
}

export type StoredTestScript = {
  id: string;
  scriptId: string;
  name: string;
  testType: string;
  caseRef: string | null;
  url: string | null;
  body: string;
  timeoutMs: number | null;
  useSession: string | null;
  saveSession: string | null;
};

// Full records including the script body — for the runner, not for the agent's
// list view (bodies are large and would flood its context).
export async function getTestScriptsByIds(
  projectId: string,
  scriptIds: string[]
): Promise<StoredTestScript[]> {
  const rows = await prisma.testScript.findMany({
    where: { projectId, scriptId: { in: scriptIds } },
    orderBy: { scriptId: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    scriptId: r.scriptId,
    name: r.name,
    testType: r.testType,
    caseRef: r.caseRef,
    url: r.url,
    body: r.body,
    timeoutMs: r.timeoutMs,
    useSession: r.useSession,
    saveSession: r.saveSession,
  }));
}

export async function getAllTestScripts(projectId: string): Promise<StoredTestScript[]> {
  const rows = await prisma.testScript.findMany({
    where: { projectId },
    orderBy: { scriptId: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    scriptId: r.scriptId,
    name: r.name,
    testType: r.testType,
    caseRef: r.caseRef,
    url: r.url,
    body: r.body,
    timeoutMs: r.timeoutMs,
    useSession: r.useSession,
    saveSession: r.saveSession,
  }));
}

// --- Test runs and executions -------------------------------------------

export async function createTestRun(
  projectId: string,
  opts: { label?: string; scriptId?: string; triggeredBy?: string } = {}
): Promise<string> {
  const id = randomUUID();
  await prisma.testRun.create({
    data: {
      id,
      projectId,
      scriptId: opts.scriptId ?? null,
      label: opts.label ?? null,
      // Written as "running" up front so a crashed/killed run is
      // distinguishable afterwards from one that genuinely finished — a run
      // still marked "running" long after the fact is itself the signal.
      status: "running",
      triggeredBy: opts.triggeredBy ?? "agent",
      startedAt: new Date().toISOString(),
    },
  });
  return id;
}

export async function finishTestRun(runId: string, status: string): Promise<void> {
  await prisma.testRun.update({
    where: { id: runId },
    data: { status, finishedAt: new Date().toISOString() },
  });
}

export type TestExecutionInput = {
  runId: string;
  caseId?: string;
  passed: boolean;
  actualResult?: string;
  errorMessage?: string;
  durationMs?: number;
};

export async function insertTestExecution(
  projectId: string,
  e: TestExecutionInput
): Promise<string> {
  const id = randomUUID();
  await prisma.testExecution.create({
    data: {
      id,
      projectId,
      runId: e.runId,
      caseId: e.caseId ?? null,
      passed: e.passed,
      actualResult: e.actualResult ?? null,
      errorMessage: e.errorMessage ?? null,
      durationMs: e.durationMs ?? null,
      executedAt: new Date().toISOString(),
    },
  });
  return id;
}

export type ExecutionEvidenceKeys = {
  traceKey?: string;
  screenshotKey?: string;
  consoleLogKey?: string;
  harKey?: string;
  videoKey?: string;
};

// Written after the execution row exists, because the storage keys embed the
// execution id — the artifacts can't be uploaded until there's an id to file
// them under.
export async function attachEvidenceToExecution(
  executionId: string,
  keys: ExecutionEvidenceKeys
): Promise<void> {
  await prisma.testExecution.update({
    where: { id: executionId },
    data: {
      traceKey: keys.traceKey ?? null,
      screenshotKey: keys.screenshotKey ?? null,
      consoleLogKey: keys.consoleLogKey ?? null,
      harKey: keys.harKey ?? null,
      videoKey: keys.videoKey ?? null,
    },
  });
}

// Mirrors the latest result onto the test case itself, so the Test Cases view
// and its .xlsx export carry Actual Result / Status without needing a join.
// updateMany (not update) because caseId is a loose reference, not a unique
// key — an unmatched caseId is a no-op rather than a thrown error, which is
// the right behaviour when the agent runs a script whose caseRef doesn't
// correspond to a saved case.
export async function applyExecutionToTestCase(
  projectId: string,
  caseId: string,
  result: { passed: boolean; actualResult?: string; comments?: string }
): Promise<number> {
  const { count } = await prisma.testCase.updateMany({
    where: { projectId, caseId },
    data: {
      status: result.passed ? "Pass" : "Fail",
      actualResult: result.actualResult ?? null,
      comments: result.comments ?? null,
      lastExecutedAt: new Date().toISOString(),
    },
  });
  return count;
}

// A background run that outlives the server process would sit at "running"
// forever, and polling it would look like "still in progress" indefinitely.
// Nothing can resume it, so past this cutoff report it as abandoned instead of
// in-flight. Comfortably above the 45-minute execution ceiling so a genuinely
// long idle test is never mislabelled.
const STALE_RUN_AFTER_MS = 60 * 60_000;

export async function getTestRunStatus(projectId: string, runId: string) {
  const run = await prisma.testRun.findFirst({
    where: { projectId, id: runId },
    include: { executions: { orderBy: { executedAt: "asc" } } },
  });
  if (!run) return null;

  const stale =
    run.status === "running" && Date.now() - run.startedAt.getTime() > STALE_RUN_AFTER_MS;

  return {
    run_id: run.id,
    label: run.label,
    // "abandoned" is derived, not stored: the row is still literally
    // "running", and saying so plainly beats silently rewriting history.
    status: stale ? "abandoned" : run.status,
    in_progress: run.status === "running" && !stale,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    elapsed_ms: (run.finishedAt?.getTime() ?? Date.now()) - run.startedAt.getTime(),
    completed_count: run.executions.length,
    passed_count: run.executions.filter((e) => e.passed).length,
    failed_count: run.executions.filter((e) => !e.passed).length,
    note: stale
      ? "This run was still marked running more than an hour after it started, which means the server process that owned it went away. Its results are incomplete and it will not resume."
      : undefined,
    executions: run.executions.map((e) => ({
      execution_id: e.id,
      case_id: e.caseId,
      passed: e.passed,
      error_message: e.errorMessage,
      duration_ms: e.durationMs,
      executed_at: e.executedAt.toISOString(),
      evidence: describeEvidence(e),
    })),
  };
}

export async function listExecutionHistory(
  projectId: string,
  opts: { caseId?: string; limit?: number } = {}
) {
  const runs = await prisma.testRun.findMany({
    where: { projectId },
    orderBy: { startedAt: "desc" },
    take: opts.limit ?? 20,
    include: {
      executions: {
        where: opts.caseId ? { caseId: opts.caseId } : undefined,
        orderBy: { executedAt: "asc" },
      },
    },
  });

  // When filtering by case, runs that never touched that case carry no
  // information — drop them rather than returning empty shells.
  const relevant = opts.caseId ? runs.filter((r) => r.executions.length > 0) : runs;

  return relevant.map((r) => ({
    run_id: r.id,
    label: r.label,
    status: r.status,
    triggered_by: r.triggeredBy,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    passed_count: r.executions.filter((e) => e.passed).length,
    failed_count: r.executions.filter((e) => !e.passed).length,
    executions: r.executions.map((e) => ({
      execution_id: e.id,
      case_id: e.caseId,
      passed: e.passed,
      actual_result: e.actualResult,
      error_message: e.errorMessage,
      duration_ms: e.durationMs,
      executed_at: e.executedAt.toISOString(),
      // Only the artifacts that actually exist, as {label, key} pairs — the
      // same shape BugReport.attachmentsJson stores, so evidence can be
      // carried onto a bug without reshaping it.
      evidence: describeEvidence(e),
    })),
  }));
}

const EVIDENCE_LABELS: { field: keyof EvidenceRow; label: string }[] = [
  { field: "screenshotKey", label: "Screenshot" },
  { field: "videoKey", label: "Video" },
  { field: "consoleLogKey", label: "Console log" },
  { field: "harKey", label: "Network HAR" },
  { field: "traceKey", label: "Playwright trace" },
];

type EvidenceRow = {
  traceKey: string | null;
  screenshotKey: string | null;
  consoleLogKey: string | null;
  harKey: string | null;
  videoKey: string | null;
};

export function describeEvidence(row: EvidenceRow): { label: string; key: string }[] {
  return EVIDENCE_LABELS.flatMap(({ field, label }) => {
    const key = row[field];
    return key ? [{ label, key }] : [];
  });
}

// Evidence for one execution, for the bug-drafting path: an agent filing a
// defect needs the keys of whatever the failing run captured.
export async function getExecutionEvidence(projectId: string, executionId: string) {
  const row = await prisma.testExecution.findFirst({
    where: { projectId, id: executionId },
    select: {
      id: true,
      caseId: true,
      passed: true,
      errorMessage: true,
      actualResult: true,
      executedAt: true,
      traceKey: true,
      screenshotKey: true,
      consoleLogKey: true,
      harKey: true,
      videoKey: true,
    },
  });
  if (!row) return null;
  return {
    execution_id: row.id,
    case_id: row.caseId,
    passed: row.passed,
    error_message: row.errorMessage,
    actual_result: row.actualResult,
    executed_at: row.executedAt.toISOString(),
    evidence: describeEvidence(row),
  };
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
  // --- Execution (real run history, not creation counts) ---
  scenarioCount: number;
  scriptCount: number;
  runCount: number;
  executionCount: number;
  executionPassCount: number;
  executionFailCount: number;
  // Distinct test cases that have ever been executed — the denominator
  // problem these stats exist to fix: a report must not present "20 test
  // cases" as "20 tested" when none of them ran.
  executedCaseCount: number;
  testCasesByStatus: { Pass: number; Fail: number; Blocked: number; NotRun: number };
  lastRun: {
    runId: string;
    label: string | null;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    passedCount: number;
    failedCount: number;
  } | null;
  topFailingCases: { caseId: string; failures: number; total: number }[];
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
    scenarioCount,
    scriptCount,
    runCount,
    executionCount,
    executionPassCount,
    executionFailCount,
    executedCaseRefs,
    testCaseStatusRows,
    lastRunRow,
    failedExecutionRows,
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
    prisma.testScenario.count({ where: { projectId } }),
    prisma.testScript.count({ where: { projectId } }),
    prisma.testRun.count({ where: { projectId } }),
    prisma.testExecution.count({ where: { projectId } }),
    prisma.testExecution.count({ where: { projectId, passed: true } }),
    prisma.testExecution.count({ where: { projectId, passed: false } }),
    prisma.testExecution.findMany({
      where: { projectId, caseId: { not: null } },
      select: { caseId: true },
      distinct: ["caseId"],
    }),
    prisma.testCase.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.testRun.findFirst({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      include: { executions: { select: { passed: true } } },
    }),
    // Grouped by case AND outcome so a case's failure count and its total run
    // count both come from one query — "3 of 5 runs failed" needs both halves.
    prisma.testExecution.groupBy({
      by: ["caseId", "passed"],
      where: { projectId, caseId: { not: null } },
      _count: { _all: true },
    }),
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

  // A test case's status is null until something executes it, so "not run" is
  // whatever the grouped statuses don't account for. Anything unexpected in
  // the column is folded into NotRun rather than silently dropped, so the four
  // buckets always sum to testCaseCount and a report can't overcount coverage.
  const testCasesByStatus = { Pass: 0, Fail: 0, Blocked: 0, NotRun: 0 };
  for (const row of testCaseStatusRows) {
    const n = row._count._all;
    if (row.status === "Pass") testCasesByStatus.Pass += n;
    else if (row.status === "Fail") testCasesByStatus.Fail += n;
    else if (row.status === "Blocked") testCasesByStatus.Blocked += n;
    else testCasesByStatus.NotRun += n;
  }

  const perCase = new Map<string, { failures: number; total: number }>();
  for (const row of failedExecutionRows) {
    if (!row.caseId) continue;
    const entry = perCase.get(row.caseId) ?? { failures: 0, total: 0 };
    entry.total += row._count._all;
    if (!row.passed) entry.failures += row._count._all;
    perCase.set(row.caseId, entry);
  }
  const topFailingCases = [...perCase.entries()]
    .filter(([, v]) => v.failures > 0)
    .map(([caseId, v]) => ({ caseId, failures: v.failures, total: v.total }))
    .sort((a, b) => b.failures - a.failures || a.caseId.localeCompare(b.caseId))
    .slice(0, 10);

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
    scenarioCount,
    scriptCount,
    runCount,
    executionCount,
    executionPassCount,
    executionFailCount,
    executedCaseCount: executedCaseRefs.length,
    testCasesByStatus,
    lastRun: lastRunRow
      ? {
          runId: lastRunRow.id,
          label: lastRunRow.label,
          status: lastRunRow.status,
          startedAt: lastRunRow.startedAt.toISOString(),
          finishedAt: lastRunRow.finishedAt?.toISOString() ?? null,
          passedCount: lastRunRow.executions.filter((e) => e.passed).length,
          failedCount: lastRunRow.executions.filter((e) => !e.passed).length,
        }
      : null,
    topFailingCases,
  };
}

import {
  getExecutionEvidence,
  getTestCaseByCaseId,
  getScriptsForCase,
  nextBugId,
  insertBugReport,
  listExecutionHistory,
} from "../db";
import { executeAndPersist, startBackgroundRun, needsBackgroundRun } from "./executeTests";

// The failure -> bug -> retest loop. Kept out of agentTools.ts so it is
// directly callable (and testable) rather than reachable only through an MCP
// tool handler — the tools below it are thin wrappers over these functions.

// Best-effort environment from the URL a test actually ran against. Only
// returns a value when the host genuinely names an environment; a host that
// says nothing yields undefined rather than a guess, so a bug never claims an
// environment nobody established.
export function inferEnvironment(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (/localhost|127\.0\.0\.1|(^|[.-])dev([.-]|$)/.test(host)) return "Dev";
  if (/(^|[.-])(sit|test|qa)([.-]|$)/.test(host)) return "SIT";
  if (/(^|[.-])(uat|stag(e|ing))([.-]|$)/.test(host)) return "UAT";
  if (/(^|[.-])(prod|www)([.-]|$)/.test(host)) return "Production";
  return undefined;
}

export type DraftBugInput = {
  executionId: string;
  title: string;
  severity: string;
  priority: string;
  environment?: string;
  description?: string;
  frequency?: string;
  rootCauseSuggestion?: string;
  bugId?: string;
};

export type DraftBugResult =
  | { ok: false; error: string }
  | {
      ok: true;
      bugId: string;
      sourceTestCase: string | null;
      environment: string | null;
      actualResult: string | null;
      attachments: { label: string; key: string }[];
      fieldsFromTestCase: string[];
      message: string;
    };

export async function draftBugFromExecution(
  projectId: string,
  input: DraftBugInput
): Promise<DraftBugResult> {
  const execution = await getExecutionEvidence(projectId, input.executionId);
  if (!execution) {
    return { ok: false, error: `No execution ${input.executionId} in this project.` };
  }
  if (execution.passed) {
    return {
      ok: false,
      error: `Execution ${input.executionId} passed — there is no defect to file from it. If you believe the test itself is wrong, say so rather than filing a bug against a passing run.`,
    };
  }

  const testCase = execution.case_id
    ? await getTestCaseByCaseId(projectId, execution.case_id)
    : null;

  let environment = input.environment;
  if (!environment && execution.case_id) {
    const scripts = await getScriptsForCase(projectId, execution.case_id);
    const url = scripts.find((s) => s.url)?.url;
    environment = url ? inferEnvironment(url) : undefined;
  }

  const bugId = input.bugId ?? (await nextBugId(projectId));

  await insertBugReport(projectId, {
    bugId,
    title: input.title,
    module: testCase?.module ?? undefined,
    description: input.description,
    preconditions: testCase?.preconditions ?? undefined,
    testData: testCase?.testData ?? undefined,
    stepsToReproduce: testCase?.steps ?? undefined,
    expectedResult: testCase?.expectedResult ?? undefined,
    // The real failure message, verbatim.
    actualResult: execution.error_message ?? execution.actual_result ?? undefined,
    severity: input.severity,
    priority: input.priority,
    frequency: input.frequency,
    environment,
    rootCauseSuggestion: input.rootCauseSuggestion,
    sourceTestCase: execution.case_id ?? undefined,
    comments: `Filed automatically from execution ${execution.execution_id} (${execution.executed_at}).`,
    status: "Open",
    attachments: execution.evidence,
    // The defect was observed when the test ran, not when this row was written.
    dateReported: execution.executed_at,
  });

  return {
    ok: true,
    bugId,
    sourceTestCase: execution.case_id,
    environment: environment ?? null,
    actualResult: execution.error_message,
    attachments: execution.evidence,
    fieldsFromTestCase: testCase
      ? ["module", "preconditions", "testData", "stepsToReproduce", "expectedResult"]
      : [],
    message: testCase
      ? `Drafted ${bugId} from execution ${execution.execution_id}, with ${execution.evidence.length} attachment(s) and the real failure message.`
      : `Drafted ${bugId}, but execution ${execution.execution_id} has no linked test case, so Module/Preconditions/Test Data/Steps/Expected Result are empty. Link the script to a test case (caseRef) so future bugs carry them.`,
  };
}

export type FixVerdict = {
  verdict: string;
  proposedBugStatus: string | null;
  flaky: boolean;
};

/**
 * The verdict rules, kept pure and separate from the run itself so they can be
 * asserted directly. The invariant that matters: a "fixed" verdict requires a
 * prior recorded FAILURE, so a test that has only ever passed can never be
 * presented as evidence that something was repaired.
 */
export function judgeFixVerdict(
  nowPassing: boolean,
  priorFailures: number,
  priorPasses: number
): FixVerdict {
  const hadFailed = priorFailures > 0;
  // Both outcomes in history means flaky, and one green re-run is then not
  // proof of anything.
  const flaky = priorFailures > 0 && priorPasses > 0;

  if (nowPassing && hadFailed) {
    return { verdict: "fixed", proposedBugStatus: "Ready for UAT", flaky };
  }
  if (nowPassing && !hadFailed) {
    return {
      verdict: "still passing (this case has no recorded failure, so nothing was verified as fixed)",
      proposedBugStatus: null,
      flaky,
    };
  }
  if (!nowPassing && hadFailed) {
    return { verdict: "still failing", proposedBugStatus: "In Progress", flaky };
  }
  return {
    verdict: "newly failing (this case passed every previous run)",
    proposedBugStatus: "Open",
    flaky,
  };
}

export type VerifyFixResult =
  | { ok: false; error: string }
  | { ok: true; background: true; runId: string; maxTimeoutMs: number; message: string }
  | {
      ok: true;
      background: false;
      caseId: string;
      bugId: string | null;
      verdict: string;
      nowPassing: boolean;
      runId: string;
      scriptsRun: string[];
      priorRuns: number;
      priorFailures: number;
      priorPasses: number;
      flaky: boolean;
      currentError: string | null;
      evidence: { label: string; key: string }[];
      proposedBugStatus: string | null;
      note?: string;
    };

export async function verifyFix(
  projectId: string,
  { caseId, bugId }: { caseId: string; bugId?: string }
): Promise<VerifyFixResult> {
  const scripts = await getScriptsForCase(projectId, caseId);
  if (scripts.length === 0) {
    return {
      ok: false,
      error: `No saved script implements ${caseId}, so there is nothing to re-run. Save one with save_test_script (caseRef: "${caseId}") first — re-running requires executing the same test, not a rewritten one.`,
    };
  }

  // Read history BEFORE re-running, so "did it fail before?" is answered by
  // the past rather than by the run about to happen.
  const priorHistory = await listExecutionHistory(projectId, { caseId });
  const priorExecutions = priorHistory.flatMap((r) => r.executions);
  const priorFailures = priorExecutions.filter((e) => !e.passed).length;
  const priorPasses = priorExecutions.length - priorFailures;

  const tests = scripts.map((s) => ({
    name: s.name,
    testType: s.testType === "api" ? ("api" as const) : ("browser" as const),
    body: s.body,
    url: s.url ?? undefined,
    caseId,
    timeoutMs: s.timeoutMs ?? undefined,
    useSession: s.useSession ?? undefined,
    saveSession: s.saveSession ?? undefined,
  }));

  const label = `Re-test ${caseId}${bugId ? ` for ${bugId}` : ""}`;

  if (needsBackgroundRun(tests)) {
    const started = await startBackgroundRun(projectId, tests, { label, triggeredBy: "agent" });
    return {
      ok: true,
      background: true,
      runId: started.runId,
      maxTimeoutMs: started.maxTimeoutMs,
      message: `${caseId} needs up to ${Math.round(started.maxTimeoutMs / 60000)} minute(s), so the re-test is running in the background as run ${started.runId}. Poll get_run_status, then judge the verdict from its result — don't state whether the fix worked until it finishes.`,
    };
  }

  const suite = await executeAndPersist(projectId, tests, { label, triggeredBy: "agent" });

  const nowPassing = suite.failedCount === 0;
  const { verdict, proposedBugStatus, flaky } = judgeFixVerdict(
    nowPassing,
    priorFailures,
    priorPasses
  );

  return {
    ok: true,
    background: false,
    caseId,
    bugId: bugId ?? null,
    verdict,
    nowPassing,
    runId: suite.runId,
    scriptsRun: scripts.map((s) => s.scriptId),
    priorRuns: priorExecutions.length,
    priorFailures,
    priorPasses,
    flaky,
    currentError: suite.results.find((r) => !r.passed)?.error ?? null,
    evidence: suite.results.flatMap((r) => r.evidence),
    proposedBugStatus,
    note: flaky
      ? "This case has both passed and failed previously, so it is flaky — one passing re-run is not sufficient evidence that the underlying defect is fixed. Say so, and re-run it a few times before closing anything."
      : bugId && proposedBugStatus
        ? `Proposed only — call update_bug_status to actually move ${bugId} to "${proposedBugStatus}".`
        : undefined,
  };
}

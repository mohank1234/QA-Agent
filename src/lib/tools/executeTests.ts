import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runPlaywrightScript,
  discardEvidence,
  EVIDENCE_FILES,
  MAX_INLINE_TIMEOUT_MS,
  type EvidenceArtifacts,
} from "./runAutomation";
import { runApiTestScript } from "./runApiTest";
import type { ScriptResult } from "./scriptRunner";
import {
  createTestRun,
  finishTestRun,
  insertTestExecution,
  applyExecutionToTestCase,
  attachEvidenceToExecution,
  type ExecutionEvidenceKeys,
} from "../db";
import { runEvidenceKey, sessionStateKey, putObject, getObject } from "../storage";
import { logger } from "../logger";

// The single place a test actually executes AND gets persisted. Both the
// ad-hoc tools (run_browser_test / run_api_test) and run_test_suite go through
// here, so there is no path where a test really ran but left no trace — which
// was the entire gap this phase exists to close.

export type ExecutableTest = {
  /** Human-readable name, used for the run label and error text. */
  name: string;
  testType: "browser" | "api";
  body: string;
  /** Browser tests only: URL to navigate to before the body runs. */
  url?: string;
  /** TestCase.caseId this verifies — what makes TC -> RUN traceable. */
  caseId?: string;
  timeoutMs?: number;
  /** Name of a stored session to start this test already logged in. */
  useSession?: string;
  /** Name to store this test's resulting session under. */
  saveSession?: string;
};

export type ExecutedTest = {
  name: string;
  caseId?: string;
  executionId: string;
  passed: boolean;
  error?: string;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  /** Artifacts captured and uploaded for this execution, as {label, key}. */
  evidence: { label: string; key: string }[];
};

export type SuiteResult = {
  runId: string;
  status: "passed" | "failed" | "partial";
  total: number;
  passedCount: number;
  failedCount: number;
  startedAt: string;
  durationMs: number;
  results: ExecutedTest[];
  /** caseIds that were reported but matched no saved test case. */
  unmatchedCaseIds: string[];
  /** Non-fatal remarks worth surfacing, e.g. a session that didn't exist yet. */
  notes: string[];
};

// Playwright's stdout/stderr can be enormous; the agent only needs enough to
// diagnose. Full output still reaches the logger.
const MAX_CAPTURED_CHARS = 4_000;

function clip(s: string): string {
  return s.length > MAX_CAPTURED_CHARS ? s.slice(0, MAX_CAPTURED_CHARS) + "\n[...truncated...]" : s;
}

// What lands in TestCase.actualResult / TestExecution.actualResult. For a pass
// there is no observed-output concept in this harness beyond "it completed
// without a failed assertion", so say exactly that rather than inventing a
// richer-sounding result.
function describeOutcome(r: ScriptResult): string {
  if (r.passed) return "Executed successfully; all assertions passed.";
  if (r.timedOut) return r.error ?? "Test timed out.";
  return r.error ?? "Test failed.";
}

// Pulls a stored session down to a local file the harness can hand to
// Playwright's storageState. Returns null when the session doesn't exist yet —
// a missing session is a normal first-run state, and the test simply starts
// logged out rather than failing.
async function materializeSession(
  projectId: string,
  name: string
): Promise<{ path: string; dir: string } | null> {
  const body = await getObject(sessionStateKey(projectId, name));
  if (!body) return null;
  const dir = path.join(os.tmpdir(), `qa-agent-session-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "storage-state.json");
  await fs.writeFile(file, body);
  return { path: file, dir };
}

async function runOne(
  projectId: string,
  test: ExecutableTest,
  allowLongTimeout: boolean
): Promise<{
  result: ScriptResult;
  durationMs: number;
  evidence?: EvidenceArtifacts;
  sessionNote?: string;
}> {
  const startedAt = Date.now();
  let session: { path: string; dir: string } | null = null;
  let sessionNote: string | undefined;

  try {
    if (test.testType === "browser") {
      if (test.useSession) {
        session = await materializeSession(projectId, test.useSession);
        if (!session) {
          sessionNote = `No saved session named "${test.useSession}" yet — this run started logged out.`;
        }
      }

      const { evidence, savedSessionStatePath, ...result } = await runPlaywrightScript(test.body, {
        url: test.url,
        timeoutMs: test.timeoutMs,
        sessionStatePath: session?.path,
        saveSessionState: !!test.saveSession,
        allowLongTimeout,
      });

      if (test.saveSession && savedSessionStatePath) {
        try {
          const body = await fs.readFile(savedSessionStatePath);
          await putObject(sessionStateKey(projectId, test.saveSession), body, "application/json");
        } catch (err) {
          logger.error({ err, projectId, session: test.saveSession }, "failed to store session state");
          sessionNote = `Session "${test.saveSession}" could not be stored.`;
        }
      }

      return { result, durationMs: Date.now() - startedAt, evidence, sessionNote };
    }

    const result = await runApiTestScript(test.body, test.timeoutMs, { allowLongTimeout });
    return { result, durationMs: Date.now() - startedAt };
  } catch (err) {
    // Thrown (rather than returned-as-failed) means the runner itself couldn't
    // start — no Chromium on Vercel, playwright not installed, etc. That is
    // still a real, recordable execution failure, not a reason to lose the run.
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: { passed: false, error: message, stdout: "", stderr: "", timedOut: false },
      durationMs: Date.now() - startedAt,
      sessionNote,
    };
  } finally {
    if (session) await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }
}

const EVIDENCE_UPLOADS: {
  file: string;
  field: keyof ExecutionEvidenceKeys;
  label: string;
  contentType: string;
  source: keyof Omit<EvidenceArtifacts, "dir">;
}[] = [
  {
    file: EVIDENCE_FILES.screenshot,
    field: "screenshotKey",
    label: "Screenshot",
    contentType: "image/png",
    source: "screenshot",
  },
  {
    file: EVIDENCE_FILES.video,
    field: "videoKey",
    label: "Video",
    contentType: "video/webm",
    source: "video",
  },
  {
    file: EVIDENCE_FILES.console,
    field: "consoleLogKey",
    label: "Console log",
    contentType: "text/plain; charset=utf-8",
    source: "console",
  },
  {
    file: EVIDENCE_FILES.har,
    field: "harKey",
    label: "Network HAR",
    contentType: "application/json",
    source: "har",
  },
  {
    file: EVIDENCE_FILES.trace,
    field: "traceKey",
    label: "Playwright trace",
    contentType: "application/zip",
    source: "trace",
  },
];

/**
 * Uploads whatever was captured and returns the stored keys. Upload failures
 * are logged and skipped rather than thrown: losing a screenshot must never
 * turn a recorded test result into a lost one.
 */
async function uploadEvidence(
  projectId: string,
  runId: string,
  executionId: string,
  evidence: EvidenceArtifacts | undefined
): Promise<{ keys: ExecutionEvidenceKeys; listed: { label: string; key: string }[] }> {
  const keys: ExecutionEvidenceKeys = {};
  const listed: { label: string; key: string }[] = [];
  if (!evidence) return { keys, listed };

  for (const spec of EVIDENCE_UPLOADS) {
    const localPath = evidence[spec.source];
    if (!localPath) continue;
    try {
      const body = await fs.readFile(localPath);
      const key = runEvidenceKey(projectId, runId, executionId, spec.file);
      await putObject(key, body, spec.contentType);
      keys[spec.field] = key;
      listed.push({ label: spec.label, key });
    } catch (err) {
      logger.error(
        { err, projectId, runId, executionId, artifact: spec.file },
        "failed to upload test evidence"
      );
    }
  }

  return { keys, listed };
}

/**
 * Runs one or more tests and persists a TestRun plus one TestExecution per
 * test, mirroring each result onto its TestCase. Always returns a run id, even
 * when every test failed — a failed run is data, not an error.
 */
export async function executeAndPersist(
  projectId: string,
  tests: ExecutableTest[],
  opts: {
    label?: string;
    scriptId?: string;
    triggeredBy?: string;
    /** Permit the long ceiling — only true for detached runs. */
    allowLongTimeout?: boolean;
    /** Reuse an already-created run row (background runs create it up front). */
    existingRunId?: string;
  } = {}
): Promise<SuiteResult> {
  const runId = opts.existingRunId ?? (await createTestRun(projectId, opts));
  const startedAt = new Date().toISOString();
  const suiteStart = Date.now();

  const results: ExecutedTest[] = [];
  const unmatchedCaseIds: string[] = [];
  const notes: string[] = [];

  for (const test of tests) {
    const { result, durationMs, evidence, sessionNote } = await runOne(
      projectId,
      test,
      opts.allowLongTimeout === true
    );
    if (sessionNote) notes.push(`${test.name}: ${sessionNote}`);
    const outcome = describeOutcome(result);

    const executionId = await insertTestExecution(projectId, {
      runId,
      caseId: test.caseId,
      passed: result.passed,
      actualResult: outcome,
      errorMessage: result.passed ? undefined : (result.error ?? undefined),
      durationMs,
    });

    // Uploaded after the row exists, since the storage key embeds its id.
    const { keys, listed } = await uploadEvidence(projectId, runId, executionId, evidence);
    if (listed.length > 0) await attachEvidenceToExecution(executionId, keys);
    await discardEvidence(evidence);

    if (test.caseId) {
      const matched = await applyExecutionToTestCase(projectId, test.caseId, {
        passed: result.passed,
        actualResult: outcome,
        comments: result.timedOut ? "Execution timed out." : undefined,
      });
      // Surfaced rather than swallowed: a typo'd caseId would otherwise look
      // like a successful link while the test case stayed silently "not run".
      if (matched === 0) unmatchedCaseIds.push(test.caseId);
    }

    results.push({
      name: test.name,
      caseId: test.caseId,
      executionId,
      passed: result.passed,
      error: result.error,
      timedOut: result.timedOut,
      durationMs,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      evidence: listed,
    });

    logger.info(
      {
        projectId,
        runId,
        executionId,
        test: test.name,
        caseId: test.caseId,
        passed: result.passed,
        durationMs,
        evidenceCount: listed.length,
      },
      "test executed"
    );
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const status: SuiteResult["status"] =
    failedCount === 0 ? "passed" : passedCount === 0 ? "failed" : "partial";

  await finishTestRun(runId, status);

  return {
    runId,
    status,
    total: results.length,
    passedCount,
    failedCount,
    startedAt,
    durationMs: Date.now() - suiteStart,
    results,
    unmatchedCaseIds,
    notes,
  };
}

// A run is "long" if any test in it could outlast a request the user is
// waiting on. Such runs must be detached — this is the whole reason the
// background model exists, since verifying a 15-minute idle timeout means
// genuinely waiting 15 minutes.
export function needsBackgroundRun(tests: ExecutableTest[]): boolean {
  return tests.some((t) => (t.timeoutMs ?? 0) > MAX_INLINE_TIMEOUT_MS);
}

/**
 * Starts a run without waiting for it. Returns as soon as the TestRun row
 * exists, so the caller gets a runId immediately; the row's status (and its
 * executions, which appear one by one as tests finish) is how progress is
 * observed afterwards.
 *
 * Deliberately fire-and-forget: nothing holds the HTTP request open. That only
 * works on a persistent server — on a serverless host the function would be
 * frozen the moment it responds. That is an acceptable constraint here because
 * real browser execution already requires a host with a Chromium binary, which
 * rules out the serverless deployment anyway (runAutomation throws early on
 * Vercel with that exact explanation).
 */
export async function startBackgroundRun(
  projectId: string,
  tests: ExecutableTest[],
  opts: { label?: string; scriptId?: string; triggeredBy?: string } = {}
): Promise<{ runId: string; testCount: number; maxTimeoutMs: number }> {
  const runId = await createTestRun(projectId, opts);

  void executeAndPersist(projectId, tests, {
    ...opts,
    allowLongTimeout: true,
    existingRunId: runId,
  })
    .then((suite) => {
      logger.info(
        { projectId, runId, status: suite.status, durationMs: suite.durationMs },
        "background run finished"
      );
    })
    .catch(async (err) => {
      // Without this the run would sit at "running" forever and look in-flight.
      logger.error({ err, projectId, runId }, "background run failed");
      await finishTestRun(runId, "failed").catch(() => {});
    });

  return {
    runId,
    testCount: tests.length,
    maxTimeoutMs: Math.max(...tests.map((t) => t.timeoutMs ?? 0), 0),
  };
}

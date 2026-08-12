import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { extractDocumentText } from "./tools/readDocument";
import { exportProjectArtifact, type ExportKind } from "./tools/exportArtifact";
import { runReadOnlyQuery, isDbConfigured } from "./tools/dbQuery";
import {
  executeAndPersist,
  startBackgroundRun,
  needsBackgroundRun,
} from "./tools/executeTests";
import { draftBugFromExecution, verifyFix } from "./tools/closeLoop";
import { buildReportData } from "./tools/reportData";
import {
  checkAgainstTemplate,
  allTemplateOutlines,
  getTemplate,
  templatesFor,
  TEMPLATES,
  isTemplatedDocType,
} from "./documentTemplates";
import { buildDocumentFileName } from "./documentNaming";
import { markdownToDocxBuffer } from "./tools/generateDocx";
import * as jira from "./tools/jiraClient";
import {
  listDocuments,
  insertRequirement,
  listRequirementsForProject,
  insertTestCase,
  listTestCasesForProject,
  insertBenchmarkRow,
  listBenchmarkRowsForProject,
  insertBugReport,
  listBugReportsForProject,
  computeProjectStats,
  saveGeneratedDocument,
  listGeneratedDocuments,
  getProject,
  insertTestScenario,
  listTestScenariosForProject,
  saveTestScript,
  listTestScripts,
  getTestScriptsByIds,
  getAllTestScripts,
  listExecutionHistory,
  getExecutionEvidence,
  getTestRunStatus,
  getBugByBugId,
  updateBugStatus,
} from "./db";
import { uploadKey, generatedDocKey, putObject, getObject, evidenceUrlFromKey } from "./storage";
import { logger } from "./logger";

function text(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export type SavedDocumentInfo = {
  title: string;
  docType: string;
  previewUrl: string;
  downloadUrl: string;
};

function withEvidenceUrls(evidence: { label: string; key: string }[]) {
  return evidence.map((e) => ({ ...e, url: evidenceUrlFromKey(e.key) }));
}


export function buildProjectTools(
  projectId: string,
  onDocumentSaved?: (doc: SavedDocumentInfo) => void
) {
  const list_documents = tool(
    "list_documents",
    "List the documents that have been provided for this project, with their file names.",
    {},
    async () => {
      const docs = await listDocuments(projectId);
      if (docs.length === 0) {
        return text("No documents have been provided for this project yet.");
      }
      return text(docs.map((d) => ({ filename: d.filename, uploadedAt: d.uploaded_at })));
    }
  );

  const read_document = tool(
    "read_document",
    "Read and extract the text content of a document previously provided for this project (PDF, DOCX, XLSX/XLS/CSV, PPTX, TXT, MD). Pass the exact file name as returned by list_documents.",
    { filename: z.string().describe("Exact file name, e.g. 'PRD.pdf'") },
    async ({ filename }) => {
      // filename here comes straight from the LLM's tool-call argument, not
      // from an HTTP route already sanitized by path.basename() — this is
      // the actual first line of defense against a poisoned document
      // convincing the agent to read an arbitrary key. uploadKey() applies
      // path.basename() internally before it ever becomes part of the key.
      const buffer = await getObject(uploadKey(projectId, filename));
      if (!buffer) {
        return text({ error: `File "${filename}" not found.` });
      }
      const content = await extractDocumentText(buffer, filename);
      return text(content);
    }
  );

  const save_requirements = tool(
    "save_requirements",
    "Persist extracted/generated requirements for this project so they are remembered across turns and can be exported into a Requirement Traceability Matrix. Call this after analyzing a document.",
    {
      requirements: z
        .array(
          z.object({
            reqId: z.string().describe("Stable requirement identifier, e.g. REQ-001"),
            reqType: z
              .string()
              .optional()
              .describe("e.g. Functional, Non-Functional, Business Rule"),
            description: z.string(),
            isAssumption: z
              .boolean()
              .optional()
              .describe("True if this was inferred rather than explicitly stated"),
            sourceDocument: z.string().optional(),
          })
        )
        .min(1),
    },
    async ({ requirements }) => {
      for (const r of requirements) await insertRequirement(projectId, r);
      return text(`Saved ${requirements.length} requirement(s).`);
    }
  );

  const list_requirements = tool(
    "list_requirements",
    "List all requirements previously saved for this project (avoid re-deriving or duplicating these).",
    {},
    async () => text(await listRequirementsForProject(projectId))
  );

  const save_test_scenarios = tool(
    "save_test_scenarios",
    "Persist test scenarios — the layer between the Test Plan and detailed test cases. A scenario is a one-line statement of what will be verified (e.g. 'Verify the user is logged out after the configured idle period'), not step-by-step detail. Save these before generating test cases, then reference each scenario from its test cases via scenarioRef, so the Test Plan -> Scenarios -> Test Cases chain is traceable. Typically 15-40 rows.",
    {
      scenarios: z
        .array(
          z.object({
            scenarioId: z.string().describe("Stable scenario identifier, e.g. SCN-001"),
            scenario: z.string().describe("One-line description of what is verified"),
            priority: z.string().optional().describe("High, Medium, or Low"),
            sourceRequirement: z.string().optional().describe("Requirement ID this derives from"),
          })
        )
        .min(1),
    },
    async ({ scenarios }) => {
      for (const s of scenarios) await insertTestScenario(projectId, s);
      return text(`Saved ${scenarios.length} test scenario(s).`);
    }
  );

  const list_test_scenarios = tool(
    "list_test_scenarios",
    "List all test scenarios previously saved for this project (check before generating more so you extend rather than duplicate).",
    {},
    async () => {
      const scenarios = await listTestScenariosForProject(projectId);
      if (scenarios.length === 0) {
        return text("No test scenarios have been saved for this project yet.");
      }
      return text(scenarios);
    }
  );

  const save_test_cases = tool(
    "save_test_cases",
    "Persist generated test cases for this project so they are remembered across turns and can be exported to Excel.",
    {
      testCases: z
        .array(
          z.object({
            caseId: z.string().describe("Stable test case identifier, e.g. TC-001"),
            sourceRequirement: z.string().optional().describe("Requirement ID this maps to"),
            scenarioRef: z
              .string()
              .optional()
              .describe("Scenario ID this test case details, e.g. SCN-001"),
            module: z.string().optional(),
            testType: z
              .string()
              .optional()
              .describe("e.g. Positive, Negative, Boundary, Edge, Regression, Smoke"),
            priority: z.string().optional(),
            severity: z.string().optional(),
            preconditions: z.string().optional(),
            steps: z.string().describe("Numbered test steps as a single string"),
            expectedResult: z.string(),
            testData: z.string().optional(),
          })
        )
        .min(1),
    },
    async ({ testCases }) => {
      for (const t of testCases) await insertTestCase(projectId, t);
      return text(`Saved ${testCases.length} test case(s).`);
    }
  );

  const list_test_cases = tool(
    "list_test_cases",
    "List all test cases previously saved for this project.",
    {},
    async () => text(await listTestCasesForProject(projectId))
  );

  const save_benchmark_rows = tool(
    "save_benchmark_rows",
    "Persist benchmark dataset rows (question/expected-answer pairs for AI/RAG validation) for this project.",
    {
      rows: z
        .array(
          z.object({
            sNo: z.number().optional(),
            agent: z.string().optional(),
            question: z.string(),
            queryCategory: z.string().optional(),
            scenarioType: z.string().optional(),
            expectedAnswer: z.string().optional().describe("Must be grounded in the source document"),
            answerInTesting: z.string().optional(),
            score: z.number().optional(),
            sourceDocument: z.string().optional(),
            notes: z.string().optional(),
            passFail: z.string().optional(),
          })
        )
        .min(1),
    },
    async ({ rows }) => {
      for (const r of rows) await insertBenchmarkRow(projectId, r);
      return text(`Saved ${rows.length} benchmark row(s).`);
    }
  );

  const list_benchmark_rows = tool(
    "list_benchmark_rows",
    "List all benchmark dataset rows previously saved for this project.",
    {},
    async () => text(await listBenchmarkRowsForProject(projectId))
  );

  const save_bug_reports = tool(
    "save_bug_reports",
    "Persist bug reports for this project so they are remembered across turns and can be exported to Excel. To attach real evidence, set `evidenceFromExecutionId` to the executionId of the failing run — the actual captured screenshot/video/console log/HAR/trace are then attached from storage. You cannot type attachments in by hand; if there is no execution, the bug simply has none.",
    {
      bugReports: z
        .array(
          z.object({
            bugId: z.string().describe("Stable bug identifier, e.g. BUG-001"),
            title: z.string().describe("Short summary of the defect"),
            module: z.string().optional().describe("Feature area, e.g. Authentication"),
            description: z.string().optional(),
            preconditions: z.string().optional().describe("State required before the steps apply"),
            testData: z
              .string()
              .optional()
              .describe("Accounts, roles, tokens, or config values the reproduction needs"),
            stepsToReproduce: z.string().optional().describe("Numbered steps"),
            expectedResult: z.string().optional(),
            actualResult: z.string().optional(),
            severity: z.string().optional().describe("Critical, High, Medium, or Low"),
            priority: z.string().optional().describe("P1, P2, P3, or P4"),
            frequency: z
              .string()
              .optional()
              .describe("How reliably it reproduces: Always, Intermittent, or Rare"),
            environment: z.string().optional().describe("Dev, SIT, UAT, or Production"),
            rootCauseSuggestion: z.string().optional(),
            sourceTestCase: z.string().optional().describe("Test case ID that surfaced this bug"),
            comments: z.string().optional(),
            status: z
              .string()
              .optional()
              .describe("Backlog, To Do, In Progress, QA Testing, Blocked, Ready for UAT, or Done — defaults to 'Open'"),
            evidenceFromExecutionId: z
              .string()
              .optional()
              .describe(
                "executionId of the failing test execution whose captured evidence should be attached to this bug. Returned by run_browser_test / run_test_suite / get_execution_history."
              ),
          })
        )
        .min(1),
    },
    async ({ bugReports }) => {
      const notes: string[] = [];
      for (const b of bugReports) {
        const { evidenceFromExecutionId, ...fields } = b;
        let attachments: { label: string; key: string }[] | undefined;

        if (evidenceFromExecutionId) {
          // Resolved from the database, never from the model's own words —
          // an attachment must point at an artifact that genuinely exists.
          const execution = await getExecutionEvidence(projectId, evidenceFromExecutionId);
          if (!execution) {
            notes.push(
              `${b.bugId}: no execution ${evidenceFromExecutionId} in this project, so no evidence was attached.`
            );
          } else if (execution.evidence.length === 0) {
            notes.push(
              `${b.bugId}: execution ${evidenceFromExecutionId} captured no evidence (API tests produce none, and passing browser tests keep no screenshot/video/HAR), so the bug has no attachments.`
            );
          } else {
            attachments = execution.evidence;
          }
        }

        await insertBugReport(projectId, { ...fields, attachments });
      }
      return text(
        [`Saved ${bugReports.length} bug report(s).`, ...notes].join(" ")
      );
    }
  );

  const list_bug_reports = tool(
    "list_bug_reports",
    "List all bug reports previously saved for this project — this doubles as the internal Kanban view (group by status) when no PM tool is connected.",
    {},
    async () => text(await listBugReportsForProject(projectId))
  );

  const get_project_stats = tool(
    "get_project_stats",
    "Get real, computed counts and rates for this project: requirement/scenario/test-case/bug/benchmark totals, requirement coverage, bug counts by status and severity, benchmark pass rate — plus real execution data (how many test cases have actually been run, pass/fail counts from real runs, the last run's outcome, and the most-failing test cases). Always call this before writing any report (Daily QA Status, Test Execution Report, Test Summary, Defect Summary, Benchmark Summary, Regression Report, Release Readiness, Requirement Coverage) and use these numbers verbatim rather than counting rows yourself. Note the difference between testCaseCount (cases written) and executedCaseCount (cases actually run) — never present the former as if it were the latter.",
    {},
    async () => {
      const stats = await computeProjectStats(projectId);
      const pct = (numerator: number, denominator: number) =>
        denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

      return text({
        ...stats,
        requirementCoveragePercent: pct(stats.requirementsWithTestCases, stats.requirementCount),
        benchmarkPassRatePercent: pct(stats.benchmarkPassCount, stats.benchmarkRowCount),
        // Share of written test cases that have ever actually been executed.
        // Null (not 0) when nothing has run, so a report says "no execution
        // data yet" rather than reporting a real-looking 0%.
        executionCoveragePercent: pct(stats.executedCaseCount, stats.testCaseCount),
        // Share of all recorded executions that passed, across run history.
        executionPassRatePercent: pct(stats.executionPassCount, stats.executionCount),
        // Share of executed test cases currently sitting at Pass.
        currentPassRatePercent: pct(stats.testCasesByStatus.Pass, stats.executedCaseCount),
        hasExecutionData: stats.executionCount > 0,
        generatedAt: new Date().toISOString(),
      });
    }
  );

  const get_report_data = tool(
    "get_report_data",
    "Get everything needed to write a report, computed from real data — including actual run history, not creation counts. Call this INSTEAD of get_project_stats when writing a Test Execution Report, Defect Summary, Release Readiness Report, Daily QA Status, or Regression Report. It separates design figures (what has been written) from execution figures (what has actually been run and passed), breaks results down by module, lists the specific failing and never-run test cases, and evaluates release-readiness conditions individually. If hasExecutionData is false, the report must say plainly that nothing has been executed rather than presenting authored test cases as results.",
    {
      reportType: z.enum([
        "test_execution",
        "defect_summary",
        "release_readiness",
        "daily_status",
        "regression",
      ]),
    },
    async ({ reportType }) => {
      try {
        return text(await buildReportData(projectId, reportType));
      } catch (err) {
        logger.error({ err, projectId }, "get_report_data failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const run_readonly_query = tool(
    "run_readonly_query",
    "Execute a read-only SQL query (SELECT / WITH...SELECT only — no INSERT/UPDATE/DELETE/DDL) against the project's configured database for data validation, duplicate detection, missing records, integrity checks, or business rule validation. Returns actual rows, capped at 500. Only available when DB_ENGINE and DATABASE_URL are configured — if not, tell the user it isn't connected and offer to generate the SQL as text instead.",
    {
      sql: z.string().describe("A single SELECT (or WITH ... SELECT) statement."),
    },
    async ({ sql }) => {
      if (!isDbConfigured()) {
        return text({
          error:
            "No database is configured for this project. Set DB_ENGINE (postgres|mysql) and DATABASE_URL in .env.local to enable live query execution — until then, I can only generate the SQL as text.",
        });
      }
      try {
        const result = await runReadOnlyQuery(sql);
        return text(result);
      } catch (err) {
        logger.error({ err, projectId }, "run_readonly_query failed");
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : String(err);
        return text({ error: [code, message].filter(Boolean).join(": ") || "Unknown database error." });
      }
    }
  );

  // Shared shape for the two ad-hoc runners below. Both persist through
  // executeAndPersist, so a one-off run leaves the same TestRun/TestExecution
  // trail a suite run does and shows up in reports and history identically.
  async function runAdHoc(
    testType: "browser" | "api",
    test: { name: string; body: string; url?: string; caseId?: string; timeoutMs?: number }
  ) {
    const suite = await executeAndPersist(
      projectId,
      [{ ...test, testType }],
      { label: test.name, triggeredBy: "agent" }
    );
    const only = suite.results[0];
    return text({
      runId: suite.runId,
      executionId: only.executionId,
      caseId: only.caseId ?? null,
      passed: only.passed,
      error: only.error,
      timedOut: only.timedOut,
      durationMs: only.durationMs,
      stdout: only.stdout,
      stderr: only.stderr,
      evidence: withEvidenceUrls(only.evidence),
      persisted: `Recorded as run ${suite.runId}${only.caseId ? ` against ${only.caseId}` : ""}.`,
      ...(suite.unmatchedCaseIds.length > 0
        ? {
            warning: `caseId "${suite.unmatchedCaseIds[0]}" does not match any saved test case, so no test case was updated. Save the test case first, or correct the ID.`,
          }
        : {}),
    });
  }

  const run_browser_test = tool(
    "run_browser_test",
    "Actually execute a Playwright browser test — not just generate script text — and permanently record the result, with evidence captured automatically. Runs in a real headless Chromium in an isolated child process with a timeout. Your `script` is the test body only (no boilerplate). Available to it: `page` (already navigated to `url` if given), `context`, `browser`, `assert(condition, message)`, plus `await newPage()` to open ANOTHER TAB sharing the same login (for multi-tab and background-tab behaviour — use `await someOtherPage.bringToFront()` to background the first tab), and `await newContext()` for a fully ISOLATED session with separate cookies (for concurrent logins). Throw/assert to fail; complete normally to pass. Pass `caseId` whenever this verifies a saved test case — that links the run to the case and makes it count toward execution stats. Max 3 minutes here; for anything longer (idle/session-timeout tests) use save_test_script with a larger timeoutMs and run it via run_test_suite, which detaches automatically. For Selenium/Cypress/Appium/Pytest (not wired up) keep generating script text as before.",
    {
      url: z.string().optional().describe("URL to navigate to before running the script"),
      script: z
        .string()
        .describe(
          "Playwright test body (async code), e.g. \"await page.click('#login'); assert(await page.title() === 'Dashboard', 'wrong title');\""
        ),
      caseId: z
        .string()
        .optional()
        .describe("Test case ID this run verifies, e.g. TC-IDLE-001 — pass it whenever one applies"),
      name: z.string().optional().describe("Short label for this run"),
      timeoutMs: z.number().optional().describe("Max time to allow, default 60000, hard cap 180000"),
    },
    async ({ url, script, caseId, name, timeoutMs }) => {
      try {
        return await runAdHoc("browser", {
          name: name ?? caseId ?? "Ad-hoc browser test",
          body: script,
          url,
          caseId,
          timeoutMs,
        });
      } catch (err) {
        logger.error({ err, projectId }, "run_browser_test failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const run_api_test = tool(
    "run_api_test",
    "Actually execute an API test — not just generate script text — and permanently record the result. Runs your test body in an isolated Node child process with a timeout, no external tooling required (uses Node's built-in fetch). Your `script` has `fetch` and an `assert(condition, message)` helper available; make request(s), inspect status/headers/body, and assert on them. Throw/assert to fail; complete normally to pass. Pass `caseId` whenever this verifies a saved test case so the result is traceable back to it. This covers what REST Assured/Postman would give you.",
    {
      script: z
        .string()
        .describe(
          "Test body (async code), e.g. \"const res = await fetch('https://api.example.com/users/1'); assert(res.status === 200, 'expected 200, got ' + res.status); const body = await res.json(); assert(body.id === 1, 'wrong id');\""
        ),
      caseId: z
        .string()
        .optional()
        .describe("Test case ID this run verifies, e.g. TC-API-004 — pass it whenever one applies"),
      name: z.string().optional().describe("Short label for this run"),
      timeoutMs: z.number().optional().describe("Max time to allow, default 30000, hard cap 60000"),
    },
    async ({ script, caseId, name, timeoutMs }) => {
      try {
        return await runAdHoc("api", {
          name: name ?? caseId ?? "Ad-hoc API test",
          body: script,
          caseId,
          timeoutMs,
        });
      } catch (err) {
        logger.error({ err, projectId }, "run_api_test failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const save_test_script = tool(
    "save_test_script",
    "Persist a re-runnable automation script for this project so you don't have to rewrite it every turn. Saving by the same scriptId again replaces the stored version (iterate freely). Once saved, run it via run_test_suite — that is what makes a regression suite, a re-run to verify a fix, and run-over-run comparison possible. Link it to a test case with caseRef so its results update that case.",
    {
      scriptId: z.string().describe("Stable script identifier, e.g. SCRIPT-IDLE-001"),
      name: z.string().describe("Human-readable name, e.g. 'Idle timeout logs user out after 15m'"),
      testType: z.enum(["browser", "api"]),
      caseRef: z.string().optional().describe("Test case ID this script implements, e.g. TC-IDLE-001"),
      url: z.string().optional().describe("Browser scripts: URL to navigate to before the body runs"),
      body: z
        .string()
        .describe(
          "The test body only, exactly as run_browser_test/run_api_test take it — no boilerplate, no imports, no wrapper function."
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          "Wall-clock limit for this script. Set it generously for tests that genuinely wait (an idle/session-timeout test verifying a 15-minute timeout needs at least ~16 minutes = 960000). Anything over 180000 makes the suite run in the background automatically."
        ),
      useSession: z
        .string()
        .optional()
        .describe(
          "Name of a saved session to start this test already logged in, avoiding a login step. Leave unset for tests that must start logged out — idle/session-timeout tests in particular, where reusing a session would defeat the test."
        ),
      saveSession: z
        .string()
        .optional()
        .describe(
          "Save this test's session (cookies + storage) under this name after it runs, so later tests can reuse the login. Typically set on a dedicated login script."
        ),
    },
    async ({ scriptId, name, testType, caseRef, url, body, timeoutMs, useSession, saveSession }) => {
      try {
        const { created } = await saveTestScript(projectId, {
          scriptId,
          name,
          testType,
          caseRef,
          url,
          body,
          timeoutMs,
          useSession,
          saveSession,
        });
        return text(
          `${created ? "Saved" : "Updated"} script ${scriptId} (${testType}${
            caseRef ? `, linked to ${caseRef}` : ""
          }). Run it with run_test_suite.`
        );
      } catch (err) {
        logger.error({ err, projectId }, "save_test_script failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const list_test_scripts = tool(
    "list_test_scripts",
    "List saved automation scripts for this project (IDs, names, type, linked test case) without their bodies. Check this before writing a new script so you extend the suite instead of duplicating it.",
    {},
    async () => {
      const scripts = await listTestScripts(projectId);
      if (scripts.length === 0) {
        return text("No test scripts have been saved for this project yet.");
      }
      return text(scripts);
    }
  );

  const run_test_suite = tool(
    "run_test_suite",
    "Execute saved test scripts for real and record the results as a single test run. Pass scriptIds to run a specific subset, or omit it to run every saved script (a full regression run). Each script's result is written to the database and mirrored onto its linked test case, so execution stats, history, and reports all reflect it. If any script's timeout exceeds 3 minutes (e.g. an idle/session-timeout test), the run automatically detaches and returns a runId immediately instead of blocking — poll it with get_run_status. Use this rather than re-running scripts one at a time via run_browser_test.",
    {
      scriptIds: z
        .array(z.string())
        .optional()
        .describe("Script IDs to run; omit to run all saved scripts"),
      label: z.string().optional().describe("Label for this run, e.g. 'Regression — build 42'"),
      background: z
        .boolean()
        .optional()
        .describe(
          "Force the run to detach and return immediately. Long scripts do this automatically; set it explicitly when you don't want to wait on a large suite."
        ),
    },
    async ({ scriptIds, label, background }) => {
      try {
        const scripts =
          scriptIds && scriptIds.length > 0
            ? await getTestScriptsByIds(projectId, scriptIds)
            : await getAllTestScripts(projectId);

        if (scripts.length === 0) {
          return text({
            error:
              scriptIds && scriptIds.length > 0
                ? `None of those script IDs are saved for this project. Call list_test_scripts to see what exists, or save_test_script first.`
                : "No test scripts have been saved for this project yet — save one with save_test_script before running a suite.",
          });
        }

        // Reported so a typo'd ID isn't silently interpreted as "that test
        // passed by not existing".
        const found = new Set(scripts.map((s) => s.scriptId));
        const missing = (scriptIds ?? []).filter((id) => !found.has(id));

        const tests = scripts.map((s) => ({
          name: s.name,
          testType: s.testType === "api" ? ("api" as const) : ("browser" as const),
          body: s.body,
          url: s.url ?? undefined,
          caseId: s.caseRef ?? undefined,
          timeoutMs: s.timeoutMs ?? undefined,
          useSession: s.useSession ?? undefined,
          saveSession: s.saveSession ?? undefined,
        }));

        // A run containing a long test cannot be awaited inside the chat
        // request — it would outlive it. Detaching is not optional there.
        if (background || needsBackgroundRun(tests)) {
          const started = await startBackgroundRun(projectId, tests, {
            label: label ?? "Test suite run",
            triggeredBy: "agent",
          });
          return text({
            runId: started.runId,
            started: true,
            background: true,
            testCount: started.testCount,
            longestTimeoutMs: started.maxTimeoutMs,
            message: `Started ${started.testCount} test(s) in the background as run ${started.runId}. This does not block — results are written as each test finishes. Poll get_run_status with this runId; the longest test may take up to ${Math.round(started.maxTimeoutMs / 60000)} minute(s). Tell the user it's running and roughly how long it should take rather than waiting silently.`,
            ...(missing.length > 0 ? { scriptIdsNotFound: missing } : {}),
          });
        }

        const suite = await executeAndPersist(projectId, tests, {
          label: label ?? "Test suite run",
          triggeredBy: "agent",
        });

        return text({
          runId: suite.runId,
          status: suite.status,
          total: suite.total,
          passed: suite.passedCount,
          failed: suite.failedCount,
          durationMs: suite.durationMs,
          results: suite.results.map((r) => ({
            name: r.name,
            executionId: r.executionId,
            caseId: r.caseId ?? null,
            passed: r.passed,
            error: r.error,
            timedOut: r.timedOut,
            durationMs: r.durationMs,
            evidence: withEvidenceUrls(r.evidence),
          })),
          ...(missing.length > 0 ? { scriptIdsNotFound: missing } : {}),
          ...(suite.unmatchedCaseIds.length > 0
            ? { caseIdsNotMatchingAnySavedTestCase: suite.unmatchedCaseIds }
            : {}),
          ...(suite.notes.length > 0 ? { notes: suite.notes } : {}),
        });
      } catch (err) {
        logger.error({ err, projectId }, "run_test_suite failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const draft_bug_from_execution = tool(
    "draft_bug_from_execution",
    "Turn a failed test execution into a full-format bug report automatically. Everything factual is filled in from real data — the actual error becomes Actual Result, the captured screenshot/video/console/HAR become Attachments, and Module/Preconditions/Test Data/Steps/Expected Result come from the linked test case — so you only supply judgement: title, severity, priority, and optionally environment. Use this instead of save_bug_reports whenever a defect came from a test run, because it cannot misquote the error or claim evidence that doesn't exist. Refuses to draft from a passing execution.",
    {
      executionId: z.string().describe("executionId of the FAILED execution this bug is about"),
      title: z
        .string()
        .describe("Short, specific summary of the defect — not just the assertion text"),
      severity: z.string().describe("Critical, High, Medium, or Low"),
      priority: z.string().describe("P1, P2, P3, or P4"),
      environment: z
        .string()
        .optional()
        .describe("Dev, SIT, UAT, or Production — inferred from the tested URL when omitted"),
      description: z.string().optional().describe("Extra context beyond the raw error"),
      frequency: z
        .string()
        .optional()
        .describe(
          "Always, Intermittent, or Rare. Base this on the test's real history — check get_execution_history for this case before asserting Always."
        ),
      rootCauseSuggestion: z.string().optional(),
      bugId: z.string().optional().describe("Defaults to the next free BUG-nnn for this project"),
    },
    async (input) => {
      try {
        const result = await draftBugFromExecution(projectId, input);
        if (!result.ok) return text({ error: result.error });
        const { ok, attachments, ...rest } = result;
        return text({ ...rest, attachments: withEvidenceUrls(attachments) });
      } catch (err) {
        logger.error({ err, projectId }, "draft_bug_from_execution failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const verify_fix = tool(
    "verify_fix",
    "Re-run the saved script(s) for a test case to check whether a defect is actually fixed, then compare against that case's earlier results. Returns a verdict grounded in real run history — fixed, still failing, or newly broken — plus a proposed bug status. It does NOT change any bug status itself; apply it with update_bug_status once you (or the user) agree. Use this for any 'is this fixed?' question rather than assuming a fix landed.",
    {
      caseId: z.string().describe("Test case to re-run, e.g. TC-IDLE-001"),
      bugId: z.string().optional().describe("Bug this verifies, so a status can be proposed for it"),
    },
    async ({ caseId, bugId }) => {
      try {
        const result = await verifyFix(projectId, { caseId, bugId });
        if (!result.ok) return text({ error: result.error });
        if (result.background) {
          const { ok, ...rest } = result;
          return text(rest);
        }
        const { ok, evidence, ...rest } = result;
        return text({ ...rest, evidence: withEvidenceUrls(evidence) });
      } catch (err) {
        logger.error({ err, projectId }, "verify_fix failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const update_bug_status = tool(
    "update_bug_status",
    "Change a bug's status in this project's internal tracker (the Kanban view). Use this to apply a status change after verify_fix proposes one, or when the user asks for it. This is the app's own database, not a shared system — it is not the same as a Jira transition, which still requires the user to ask explicitly.",
    {
      bugId: z.string().describe("e.g. BUG-001"),
      status: z
        .string()
        .describe("Backlog, To Do, In Progress, QA Testing, Blocked, Ready for UAT, Done, or Closed"),
      comments: z.string().optional().describe("Replaces the bug's Comments field when given"),
    },
    async ({ bugId, status, comments }) => {
      const existing = await getBugByBugId(projectId, bugId);
      if (!existing) {
        return text({ error: `No bug ${bugId} in this project.` });
      }
      await updateBugStatus(projectId, bugId, status, comments);
      return text(`${bugId}: "${existing.status}" -> "${status}".`);
    }
  );

  const get_run_status = tool(
    "get_run_status",
    "Check a test run's progress by runId — use this to follow a background run started by run_test_suite. Returns whether it is still in progress, how many tests have completed so far, and each finished test's result and evidence. Results appear one at a time as tests finish, so calling this again later shows more. If it reports status 'abandoned', the server process that owned the run went away and it will not resume — say so rather than continuing to wait.",
    { runId: z.string().describe("Run ID returned by run_test_suite") },
    async ({ runId }) => {
      const status = await getTestRunStatus(projectId, runId);
      if (!status) {
        return text({ error: `No run ${runId} in this project.` });
      }
      return text({
        ...status,
        executions: status.executions.map((e) => ({
          ...e,
          evidence: withEvidenceUrls(e.evidence),
        })),
      });
    }
  );

  const get_execution_history = tool(
    "get_execution_history",
    "Get real past test runs for this project — most recent first, with each run's pass/fail counts, per-test results, and the evidence captured for each execution (screenshot, video, console log, network HAR, Playwright trace). Pass caseId to see one test case's history across runs, which is how you tell a consistently failing test from a flaky one, and how you confirm a re-run actually verified a fix. Each execution's executionId can be passed to save_bug_reports as evidenceFromExecutionId to attach its real evidence to a defect. Use this for any Test Execution Report, Regression Report, or 'has this been fixed' question rather than assuming.",
    {
      caseId: z.string().optional().describe("Only show runs that executed this test case"),
      limit: z.number().optional().describe("How many runs to return, default 20"),
    },
    async ({ caseId, limit }) => {
      const rawHistory = await listExecutionHistory(projectId, { caseId, limit });
      const history = rawHistory.map((run) => ({
        ...run,
        executions: run.executions.map((e) => ({
          ...e,
          evidence: withEvidenceUrls(e.evidence),
        })),
      }));
      if (history.length === 0) {
        return text(
          caseId
            ? `No recorded executions for ${caseId} — it has never been run.`
            : "No tests have been executed for this project yet."
        );
      }
      return text(history);
    }
  );

  function notConfigured() {
    return text({
      error:
        "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env.local to enable it.",
    });
  }

  const jira_search_issues = tool(
    "jira_search_issues",
    "Search Jira for epics/stories/tasks/bugs using JQL. Read-only. Returns key, summary, status, issue type, priority, and description for each match.",
    {
      jql: z.string().describe("JQL query, e.g. \"project = ABC AND issuetype = Story AND status != Done\""),
      maxResults: z.number().optional().describe("Default 25"),
    },
    async ({ jql, maxResults }) => {
      if (!jira.isJiraConfigured()) return notConfigured();
      try {
        return text(await jira.searchIssues(jql, maxResults));
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const jira_get_issue = tool(
    "jira_get_issue",
    "Get a single Jira issue by key (e.g. its full description / acceptance criteria). Read-only.",
    { key: z.string().describe("Issue key, e.g. ABC-123") },
    async ({ key }) => {
      if (!jira.isJiraConfigured()) return notConfigured();
      try {
        return text(await jira.getIssue(key));
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const jira_create_issue = tool(
    "jira_create_issue",
    "Create a new Jira issue (e.g. a defect found during testing). WRITES to a shared system your teammates see — only call this when the user has explicitly asked, in their current message, for a Jira issue to be created. Never call it on your own initiative just because you found/generated a bug.",
    {
      projectKey: z.string().describe("Jira project key, e.g. ABC"),
      issueType: z.string().describe("e.g. Bug, Task, Story"),
      summary: z.string(),
      description: z.string().optional(),
    },
    async ({ projectKey, issueType, summary, description }) => {
      if (!jira.isJiraConfigured()) return notConfigured();
      try {
        const result = await jira.createIssue({ projectKey, issueType, summary, description });
        return text({ message: `Created ${result.key}.`, key: result.key });
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const jira_transition_issue = tool(
    "jira_transition_issue",
    "Move a Jira issue to a different status (e.g. 'In Progress', 'Done'). WRITES to a shared system — only call when the user has explicitly asked for this specific status change in their current message.",
    {
      key: z.string().describe("Issue key, e.g. ABC-123"),
      statusName: z.string().describe("Target status name — must match one of the issue's available transitions"),
    },
    async ({ key, statusName }) => {
      if (!jira.isJiraConfigured()) return notConfigured();
      try {
        await jira.transitionIssue(key, statusName);
        return text(`Moved ${key} to "${statusName}".`);
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const jira_add_comment = tool(
    "jira_add_comment",
    "Add a comment to a Jira issue (e.g. QA notes/findings). WRITES to a shared system — only call when the user has explicitly asked for this comment to be posted in their current message.",
    {
      key: z.string().describe("Issue key, e.g. ABC-123"),
      body: z.string(),
    },
    async ({ key, body }) => {
      if (!jira.isJiraConfigured()) return notConfigured();
      try {
        await jira.addComment(key, body);
        return text(`Comment added to ${key}.`);
      } catch (err) {
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const save_document = tool(
    "save_document",
    "Persist ONE long-form narrative deliverable as a real, downloadable, previewable Word (.docx) document — instead of pasting it into the chat reply. A Test Plan and a Test Strategy are two SEPARATE documents and must never be combined into one call: they sit at different levels (a strategy is programme-wide and standing; a plan is per release and cites the strategy), so a merged file is wrong at both. Call this once per document. Test Plan and Test Strategy have required section structures (IEEE 829 / ISO-IEC-IEEE 29119-3 aligned) and are rejected if sections are missing — the error lists exactly what to add. After saving, reply in chat with only a short summary and point the user to the Documents tab; do not also paste the full document text into your message.",
    {
      title: z.string().describe("Document title, e.g. 'SmartLeave Test Plan & Test Strategy'"),
      docType: z
        .enum([
          "test_plan",
          "test_strategy",
          "test_summary_report",
          "defect_summary_report",
          "release_readiness_report",
          "daily_status_report",
          "requirement_coverage_report",
          "other",
        ])
        .describe("Category of document"),
      templateId: z
        .string()
        .optional()
        .describe(
          `Which format to use, for test_plan and test_strategy. If the user picked a format, pass its id. Omit to use the default (ieee-829 / istqb-standard). Available:\n${TEMPLATES.map(
            (t) => `  ${t.id} (${t.docType}) — ${t.name}: ${t.bestFor}`
          ).join("\n")}`
        ),
      content: z
        .string()
        .describe(
          `Full document content in Markdown: '#'/'##'/'###' for headings, '| a | b |' rows for tables, '- ' for bullet lists, '**text**' for bold. This becomes the real Word document, so write it out completely here — not abbreviated. Use tables generously for anything matrix-shaped (risk matrices, RACI, severity/priority definitions, entry/exit criteria, schedules) — they render as properly formatted tables with styled headers.\n\nFor test_plan and test_strategy the chosen format's section structure is mandatory:\n\n${allTemplateOutlines()}`
        ),
    },
    async ({ title, docType, content, templateId }) => {
      try {
        // A deliverable that skips required sections is rejected here rather
        // than saved and discovered later by whoever has to sign it off. The
        // agent gets the exact missing headings back so it can fix them.
        const check = checkAgainstTemplate(docType, content, templateId);
        if (check && !check.ok) {
          return text({
            error: `This ${check.templateName} is missing required sections and was NOT saved.`,
            missingSections: check.missing,
            instruction: `Regenerate the document including every missing section above, as '## ' headings, in the template's order. Write real content under each — if a section genuinely does not apply, keep the heading and state why in one line rather than dropping it.`,
            requiredOrder: getTemplate(docType, templateId)?.sections,
          });
        }
        const template = getTemplate(docType, templateId);

        // Named for a human recipient, and versioned against what this project
        // already has so a regenerated document reads as a revision instead of
        // colliding or overwriting.
        const existing = await listGeneratedDocuments(projectId);
        const { fileName, version } = buildDocumentFileName(
          title,
          docType,
          existing.map((d) => d.filename)
        );

        const buffer = await markdownToDocxBuffer(title, content, {
          documentType: template
            ? template.docType === "test_plan"
              ? "Test Plan"
              : "Test Strategy"
            : docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          templateName: template?.name,
          projectName: (await getProject(projectId))?.name,
          version: `${version}.0`,
          theme: template?.theme,
        });
        await putObject(
          generatedDocKey(projectId, fileName),
          buffer,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        await saveGeneratedDocument(projectId, title, docType, fileName, content);
        const previewUrl = `/api/generated-documents/${projectId}/${fileName}/preview`;
        const downloadUrl = `/api/generated-documents/${projectId}/${fileName}`;
        onDocumentSaved?.({ title, docType, previewUrl, downloadUrl });
        return text({
          message: `Saved "${title}" as a Word document — view it in the Documents tab.`,
          previewUrl,
          downloadUrl,
        });
      } catch (err) {
        logger.error({ err, projectId }, "save_document failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const list_document_formats = tool(
    "list_document_formats",
    "List the available Test Plan and Test Strategy formats the user can choose from, with what each is based on and what it suits. Call this when the user asks for a plan or strategy without naming a format, and offer them the choice before writing — different formats suit regulated delivery, modern standards, agile sprints and client UAT, and picking for them is usually wrong. Pass the chosen id as templateId to save_document.",
    {
      docType: z
        .enum(["test_plan", "test_strategy"])
        .optional()
        .describe("Restrict to one document type; omit for all"),
    },
    async ({ docType }) => {
      const list = docType ? templatesFor(docType) : TEMPLATES;
      return text(
        list.map((t) => ({
          id: t.id,
          docType: t.docType,
          name: t.name,
          description: t.description,
          basedOn: t.basis,
          bestFor: t.bestFor,
          length: t.lengthGuide,
          sectionCount: t.sections.length,
        }))
      );
    }
  );

  const list_generated_documents = tool(
    "list_generated_documents",
    "List narrative documents (Test Plans, Reports, etc.) already generated for this project, so you don't regenerate one that already exists unless asked to.",
    {},
    async () => {
      const docs = await listGeneratedDocuments(projectId);
      if (docs.length === 0) {
        return text("No documents have been generated for this project yet.");
      }
      return text(docs);
    }
  );

  const export_artifact = tool(
    "export_artifact",
    "Export saved data to a real .xlsx file the user can download. kind='requirements' exports the Requirement Traceability Matrix, 'test_scenarios' exports the scenario list, 'test_cases' exports the test case suite (including Actual Result and Status from real runs), 'benchmark' exports the benchmark dataset, 'bug_reports' exports bug reports, 'test_executions' exports the real execution history run by run.",
    {
      kind: z.enum([
        "requirements",
        "test_scenarios",
        "test_cases",
        "benchmark",
        "bug_reports",
        "test_executions",
      ]),
    },
    async ({ kind }) => {
      try {
        const result = await exportProjectArtifact(projectId, kind as ExportKind);
        return text({
          message: `Exported ${result.rowCount} row(s).`,
          downloadUrl: `/api/exports/${projectId}/${result.fileName}`,
        });
      } catch (err) {
        logger.error({ err, projectId }, "export_artifact failed");
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  return createSdkMcpServer({
    name: "qa",
    tools: [
      list_documents,
      read_document,
      save_requirements,
      list_requirements,
      save_test_scenarios,
      list_test_scenarios,
      save_test_cases,
      list_test_cases,
      save_benchmark_rows,
      list_benchmark_rows,
      save_bug_reports,
      list_bug_reports,
      draft_bug_from_execution,
      update_bug_status,
      verify_fix,
      get_project_stats,
      get_report_data,
      run_readonly_query,
      run_browser_test,
      run_api_test,
      save_test_script,
      list_test_scripts,
      run_test_suite,
      get_run_status,
      get_execution_history,
      jira_search_issues,
      jira_get_issue,
      jira_create_issue,
      jira_transition_issue,
      jira_add_comment,
      export_artifact,
      save_document,
      list_document_formats,
      list_generated_documents,
    ],
  });
}

export const PROJECT_TOOL_NAMES = [
  "mcp__qa__list_documents",
  "mcp__qa__read_document",
  "mcp__qa__save_requirements",
  "mcp__qa__list_requirements",
  "mcp__qa__save_test_scenarios",
  "mcp__qa__list_test_scenarios",
  "mcp__qa__save_test_cases",
  "mcp__qa__list_test_cases",
  "mcp__qa__save_benchmark_rows",
  "mcp__qa__list_benchmark_rows",
  "mcp__qa__save_bug_reports",
  "mcp__qa__list_bug_reports",
  "mcp__qa__draft_bug_from_execution",
  "mcp__qa__update_bug_status",
  "mcp__qa__verify_fix",
  "mcp__qa__get_project_stats",
  "mcp__qa__get_report_data",
  "mcp__qa__run_readonly_query",
  "mcp__qa__run_browser_test",
  "mcp__qa__run_api_test",
  "mcp__qa__save_test_script",
  "mcp__qa__list_test_scripts",
  "mcp__qa__run_test_suite",
  "mcp__qa__get_run_status",
  "mcp__qa__get_execution_history",
  "mcp__qa__jira_search_issues",
  "mcp__qa__jira_get_issue",
  "mcp__qa__jira_create_issue",
  "mcp__qa__jira_transition_issue",
  "mcp__qa__jira_add_comment",
  "mcp__qa__export_artifact",
  "mcp__qa__save_document",
  "mcp__qa__list_document_formats",
  "mcp__qa__list_generated_documents",
];

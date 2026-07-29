import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { extractDocumentText } from "./tools/readDocument";
import { exportProjectArtifact, type ExportKind } from "./tools/exportArtifact";
import { runReadOnlyQuery, isDbConfigured } from "./tools/dbQuery";
import { runPlaywrightScript } from "./tools/runAutomation";
import { runApiTestScript } from "./tools/runApiTest";
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
} from "./db";
import { projectUploadsDir, projectGeneratedDocsDir } from "./paths";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "document"
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

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

function resolveUploadedFile(projectId: string, filename: string): string {
  const dir = projectUploadsDir(projectId);
  const resolved = path.resolve(dir, filename);
  if (!resolved.startsWith(path.resolve(dir))) {
    throw new Error("Invalid file name.");
  }
  return resolved;
}

export type SavedDocumentInfo = {
  title: string;
  docType: string;
  previewUrl: string;
  downloadUrl: string;
};

export function buildProjectTools(
  projectId: string,
  onDocumentSaved?: (doc: SavedDocumentInfo) => void
) {
  const list_documents = tool(
    "list_documents",
    "List the documents that have been provided for this project, with their file names.",
    {},
    async () => {
      const docs = listDocuments(projectId) as { filename: string; uploaded_at: string }[];
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
      const filePath = resolveUploadedFile(projectId, filename);
      const content = await extractDocumentText(filePath);
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
      for (const r of requirements) insertRequirement(projectId, r);
      return text(`Saved ${requirements.length} requirement(s).`);
    }
  );

  const list_requirements = tool(
    "list_requirements",
    "List all requirements previously saved for this project (avoid re-deriving or duplicating these).",
    {},
    async () => text(listRequirementsForProject(projectId))
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
      for (const t of testCases) insertTestCase(projectId, t);
      return text(`Saved ${testCases.length} test case(s).`);
    }
  );

  const list_test_cases = tool(
    "list_test_cases",
    "List all test cases previously saved for this project.",
    {},
    async () => text(listTestCasesForProject(projectId))
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
      for (const r of rows) insertBenchmarkRow(projectId, r);
      return text(`Saved ${rows.length} benchmark row(s).`);
    }
  );

  const list_benchmark_rows = tool(
    "list_benchmark_rows",
    "List all benchmark dataset rows previously saved for this project.",
    {},
    async () => text(listBenchmarkRowsForProject(projectId))
  );

  const save_bug_reports = tool(
    "save_bug_reports",
    "Persist bug reports for this project so they are remembered across turns and can be exported to Excel.",
    {
      bugReports: z
        .array(
          z.object({
            bugId: z.string().describe("Stable bug identifier, e.g. BUG-001"),
            title: z.string(),
            description: z.string().optional(),
            stepsToReproduce: z.string().optional(),
            expectedResult: z.string().optional(),
            actualResult: z.string().optional(),
            severity: z.string().optional().describe("e.g. Critical, High, Medium, Low"),
            priority: z.string().optional(),
            environment: z.string().optional(),
            rootCauseSuggestion: z.string().optional(),
            sourceTestCase: z.string().optional().describe("Test case ID that surfaced this bug"),
            status: z
              .string()
              .optional()
              .describe("Backlog, To Do, In Progress, QA Testing, Blocked, Ready for UAT, or Done — defaults to 'Open'"),
          })
        )
        .min(1),
    },
    async ({ bugReports }) => {
      for (const b of bugReports) insertBugReport(projectId, b);
      return text(`Saved ${bugReports.length} bug report(s).`);
    }
  );

  const list_bug_reports = tool(
    "list_bug_reports",
    "List all bug reports previously saved for this project — this doubles as the internal Kanban view (group by status) when no PM tool is connected.",
    {},
    async () => text(listBugReportsForProject(projectId))
  );

  const get_project_stats = tool(
    "get_project_stats",
    "Get real, computed counts and rates for this project (requirement/test-case/bug/benchmark totals, requirement coverage, bug counts by status and severity, benchmark pass rate and average score). Always call this before writing any report (Daily QA Status, Test Execution Report, Test Summary, Defect Summary, Benchmark Summary, Regression Report, Release Readiness, Requirement Coverage) — use these numbers verbatim rather than counting rows yourself from list_* output, so reports never misstate a total.",
    {},
    async () => {
      const stats = computeProjectStats(projectId);
      const requirementCoveragePercent =
        stats.requirementCount === 0
          ? null
          : Math.round((stats.requirementsWithTestCases / stats.requirementCount) * 1000) / 10;
      const benchmarkPassRatePercent =
        stats.benchmarkRowCount === 0
          ? null
          : Math.round((stats.benchmarkPassCount / stats.benchmarkRowCount) * 1000) / 10;
      return text({
        ...stats,
        requirementCoveragePercent,
        benchmarkPassRatePercent,
        generatedAt: new Date().toISOString(),
      });
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
        console.error("run_readonly_query failed:", err);
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : String(err);
        return text({ error: [code, message].filter(Boolean).join(": ") || "Unknown database error." });
      }
    }
  );

  const run_browser_test = tool(
    "run_browser_test",
    "Actually execute a Playwright browser test — not just generate script text. Runs in a real headless Chromium in an isolated child process with a timeout. Your `script` is the test body only (no boilerplate): it runs with `page`, `context`, `browser` already available (page is already navigated to `url` if provided) plus an `assert(condition, message)` helper. Throw/assert to fail the test; complete normally to pass. Use this for actual UI/E2E test execution; for Selenium/Cypress/Appium/REST Assured/Pytest (not wired up) keep generating script text as before.",
    {
      url: z.string().optional().describe("URL to navigate to before running the script"),
      script: z
        .string()
        .describe(
          "Playwright test body (async code), e.g. \"await page.click('#login'); assert(await page.title() === 'Dashboard', 'wrong title');\""
        ),
      timeoutMs: z.number().optional().describe("Max time to allow, default 60000, hard cap 180000"),
    },
    async ({ url, script, timeoutMs }) => {
      try {
        const result = await runPlaywrightScript(script, { url, timeoutMs });
        return text(result);
      } catch (err) {
        console.error("run_browser_test failed:", err);
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  const run_api_test = tool(
    "run_api_test",
    "Actually execute an API test — not just generate script text. Runs your test body in an isolated Node child process with a timeout, no external tooling required (uses Node's built-in fetch). Your `script` has `fetch` and an `assert(condition, message)` helper available; make request(s), inspect status/headers/body, and assert on them. Throw/assert to fail; complete normally to pass. This covers what REST Assured/Postman would give you — use it instead of only generating script text for API tests.",
    {
      script: z
        .string()
        .describe(
          "Test body (async code), e.g. \"const res = await fetch('https://api.example.com/users/1'); assert(res.status === 200, 'expected 200, got ' + res.status); const body = await res.json(); assert(body.id === 1, 'wrong id');\""
        ),
      timeoutMs: z.number().optional().describe("Max time to allow, default 30000, hard cap 60000"),
    },
    async ({ script, timeoutMs }) => {
      try {
        const result = await runApiTestScript(script, timeoutMs);
        return text(result);
      } catch (err) {
        console.error("run_api_test failed:", err);
        return text({ error: err instanceof Error ? err.message : String(err) });
      }
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
    "Persist a long-form narrative deliverable (Test Plan, Test Strategy, Test Summary Report, Defect Summary Report, Release Readiness Report, Daily QA Status, Requirement Coverage Report, or similar) as a real, downloadable, previewable Word (.docx) document — instead of pasting the whole thing into the chat reply. After calling this, reply in chat with only a short summary (a few sentences: what's covered, key assumptions/gaps) and point the user to the Documents tab; do not also paste the full document text into your chat message.",
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
      content: z
        .string()
        .describe(
          "Full document content in Markdown: '#'/'##'/'###' for headings, '| a | b |' rows for tables, '- ' for bullet lists, '**text**' for bold. This becomes the real Word document, so write it out completely here — not abbreviated."
        ),
    },
    async ({ title, docType, content }) => {
      try {
        const buffer = await markdownToDocxBuffer(title, content);
        const fileName = `${timestamp()}_${slugify(title)}.docx`;
        const filePath = path.join(projectGeneratedDocsDir(projectId), fileName);
        fs.writeFileSync(filePath, buffer);
        saveGeneratedDocument(projectId, title, docType, fileName, content);
        const previewUrl = `/api/generated-documents/${projectId}/${fileName}/preview`;
        const downloadUrl = `/api/generated-documents/${projectId}/${fileName}`;
        onDocumentSaved?.({ title, docType, previewUrl, downloadUrl });
        return text({
          message: `Saved "${title}" as a Word document — view it in the Documents tab.`,
          previewUrl,
          downloadUrl,
        });
      } catch (err) {
        console.error("save_document failed:", err);
        return text({ error: err instanceof Error ? err.stack ?? err.message : String(err) });
      }
    }
  );

  const list_generated_documents = tool(
    "list_generated_documents",
    "List narrative documents (Test Plans, Reports, etc.) already generated for this project, so you don't regenerate one that already exists unless asked to.",
    {},
    async () => {
      const docs = listGeneratedDocuments(projectId);
      if (docs.length === 0) {
        return text("No documents have been generated for this project yet.");
      }
      return text(docs);
    }
  );

  const export_artifact = tool(
    "export_artifact",
    "Export saved data to a real .xlsx file the user can download. kind='requirements' exports the Requirement Traceability Matrix, 'test_cases' exports the test case suite, 'benchmark' exports the benchmark dataset, 'bug_reports' exports bug reports.",
    {
      kind: z.enum(["requirements", "test_cases", "benchmark", "bug_reports"]),
    },
    async ({ kind }) => {
      try {
        const result = exportProjectArtifact(projectId, kind as ExportKind);
        return text({
          message: `Exported ${result.rowCount} row(s).`,
          downloadUrl: `/api/exports/${projectId}/${result.fileName}`,
        });
      } catch (err) {
        console.error("export_artifact failed:", err);
        return text({ error: err instanceof Error ? err.stack ?? err.message : String(err) });
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
      save_test_cases,
      list_test_cases,
      save_benchmark_rows,
      list_benchmark_rows,
      save_bug_reports,
      list_bug_reports,
      get_project_stats,
      run_readonly_query,
      run_browser_test,
      run_api_test,
      jira_search_issues,
      jira_get_issue,
      jira_create_issue,
      jira_transition_issue,
      jira_add_comment,
      export_artifact,
      save_document,
      list_generated_documents,
    ],
  });
}

export const PROJECT_TOOL_NAMES = [
  "mcp__qa__list_documents",
  "mcp__qa__read_document",
  "mcp__qa__save_requirements",
  "mcp__qa__list_requirements",
  "mcp__qa__save_test_cases",
  "mcp__qa__list_test_cases",
  "mcp__qa__save_benchmark_rows",
  "mcp__qa__list_benchmark_rows",
  "mcp__qa__save_bug_reports",
  "mcp__qa__list_bug_reports",
  "mcp__qa__get_project_stats",
  "mcp__qa__run_readonly_query",
  "mcp__qa__run_browser_test",
  "mcp__qa__run_api_test",
  "mcp__qa__jira_search_issues",
  "mcp__qa__jira_get_issue",
  "mcp__qa__jira_create_issue",
  "mcp__qa__jira_transition_issue",
  "mcp__qa__jira_add_comment",
  "mcp__qa__export_artifact",
  "mcp__qa__save_document",
  "mcp__qa__list_generated_documents",
];

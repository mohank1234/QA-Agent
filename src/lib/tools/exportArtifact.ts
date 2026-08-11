import * as XLSX from "xlsx";
import { prisma } from "../prisma";
import { exportKey, putObject } from "../storage";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildSheetBuffer(rows: Record<string, unknown>[], sheetName: string): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  // XLSX.writeFile() does its own environment feature-detection to decide how
  // to save, which misbehaves under Next.js/Turbopack bundling ("cannot save
  // file"). Getting a Buffer directly sidesteps that entirely.
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export type ExportKind =
  | "requirements"
  | "test_scenarios"
  | "test_cases"
  | "benchmark"
  | "bug_reports"
  | "test_executions";

async function rowsForKind(projectId: string, kind: ExportKind) {
  switch (kind) {
    case "requirements": {
      const rows = await prisma.requirement.findMany({
        where: { projectId },
        orderBy: { reqId: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "Requirement ID": r.reqId,
          Type: r.reqType,
          Description: r.description,
          Assumption: r.isAssumption === 1 ? "Yes" : "No",
          "Source Document": r.sourceDocument,
        })),
        baseName: "requirements_rtm",
        sheetName: "Requirements",
      };
    }
    case "test_scenarios": {
      const rows = await prisma.testScenario.findMany({
        where: { projectId },
        orderBy: { scenarioId: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "Scenario ID": r.scenarioId,
          Scenario: r.scenario,
          Priority: r.priority,
          "Requirement Mapping": r.sourceRequirement,
        })),
        baseName: "test_scenarios",
        sheetName: "Test Scenarios",
      };
    }
    case "test_cases": {
      const rows = await prisma.testCase.findMany({
        where: { projectId },
        orderBy: { caseId: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "Test Case ID": r.caseId,
          "Requirement Mapping": r.sourceRequirement,
          "Scenario Mapping": r.scenarioRef,
          Module: r.module,
          "Test Type": r.testType,
          Priority: r.priority,
          Severity: r.severity,
          Preconditions: r.preconditions,
          "Test Data": r.testData,
          "Test Steps": r.steps,
          "Expected Result": r.expectedResult,
          // Blank rather than "Not run" — an empty cell in a QA sheet reads
          // unambiguously as "no result yet", where a filled-in word can be
          // mistaken for an outcome.
          "Actual Result": r.actualResult ?? "",
          Status: r.status ?? "",
          "Last Executed": r.lastExecutedAt ? r.lastExecutedAt.toISOString() : "",
          Comments: r.comments ?? "",
        })),
        baseName: "test_cases",
        sheetName: "Test Cases",
      };
    }
    case "test_executions": {
      const runs = await prisma.testRun.findMany({
        where: { projectId },
        orderBy: { startedAt: "desc" },
        include: { executions: { orderBy: { executedAt: "asc" } } },
      });
      // Flattened one row per execution — a run with no executions still
      // appears, so an aborted run isn't invisible in the report.
      const rows = runs.flatMap((run) =>
        run.executions.length === 0
          ? [
              {
                "Run ID": run.id,
                "Run Label": run.label,
                "Run Status": run.status,
                "Started At": run.startedAt.toISOString(),
                "Finished At": run.finishedAt ? run.finishedAt.toISOString() : "",
                "Test Case ID": "",
                Result: "",
                "Actual Result": "",
                Error: "",
                "Duration (ms)": "",
                "Executed At": "",
              },
            ]
          : run.executions.map((e) => ({
              "Run ID": run.id,
              "Run Label": run.label,
              "Run Status": run.status,
              "Started At": run.startedAt.toISOString(),
              "Finished At": run.finishedAt ? run.finishedAt.toISOString() : "",
              "Test Case ID": e.caseId ?? "",
              Result: e.passed ? "Pass" : "Fail",
              "Actual Result": e.actualResult ?? "",
              Error: e.errorMessage ?? "",
              "Duration (ms)": e.durationMs ?? "",
              "Executed At": e.executedAt.toISOString(),
            }))
      );
      return { rows, baseName: "test_executions", sheetName: "Execution History" };
    }
    case "bug_reports": {
      const rows = await prisma.bugReport.findMany({
        where: { projectId },
        orderBy: { bugId: "asc" },
      });
      return {
        // Column order follows the bug report template the project documents,
        // not the schema's field order.
        rows: rows.map((r) => ({
          "Bug ID": r.bugId,
          "Title / Summary": r.title,
          Module: r.module,
          Environment: r.environment,
          Severity: r.severity,
          Priority: r.priority,
          "Date Reported": r.dateReported.toISOString(),
          Status: r.status,
          Preconditions: r.preconditions,
          "Test Data": r.testData,
          Description: r.description,
          "Steps to Reproduce": r.stepsToReproduce,
          "Actual Result": r.actualResult,
          "Expected Result": r.expectedResult,
          Frequency: r.frequency,
          Attachments: r.attachmentsJson
            ? (JSON.parse(r.attachmentsJson) as { label: string }[])
                .map((a) => a.label)
                .join(", ")
            : "",
          "Root Cause Suggestion": r.rootCauseSuggestion,
          "Source Test Case": r.sourceTestCase,
          Comments: r.comments,
        })),
        baseName: "bug_reports",
        sheetName: "Bug Reports",
      };
    }
    case "benchmark": {
      const rows = await prisma.benchmarkRow.findMany({
        where: { projectId },
        orderBy: { sNo: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "S.No": r.sNo,
          Agent: r.agent,
          Question: r.question,
          "Query Category": r.queryCategory,
          "Scenario Type": r.scenarioType,
          "Expected Answer": r.expectedAnswer,
          "Answer in Testing": r.answerInTesting,
          Score: r.score,
          "Source Document": r.sourceDocument,
          "Notes / Edge Flag": r.notes,
          "Pass / Fail": r.passFail,
        })),
        baseName: "benchmark_dataset",
        sheetName: "Benchmark",
      };
    }
  }
}

export async function exportProjectArtifact(
  projectId: string,
  kind: ExportKind
): Promise<{ fileName: string; key: string; rowCount: number }> {
  const { rows, baseName, sheetName } = await rowsForKind(projectId, kind);

  if (rows.length === 0) {
    throw new Error(
      `No ${kind.replace("_", " ")} saved yet for this project — nothing to export.`
    );
  }

  const fileName = `${timestamp()}_${baseName}.xlsx`;
  const key = exportKey(projectId, fileName);
  const buffer = buildSheetBuffer(rows, sheetName);
  await putObject(key, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  return { fileName, key, rowCount: rows.length };
}

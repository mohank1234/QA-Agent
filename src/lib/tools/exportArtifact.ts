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

export type ExportKind = "requirements" | "test_cases" | "benchmark" | "bug_reports";

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
    case "test_cases": {
      const rows = await prisma.testCase.findMany({
        where: { projectId },
        orderBy: { caseId: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "Test Case ID": r.caseId,
          "Requirement Mapping": r.sourceRequirement,
          Module: r.module,
          "Test Type": r.testType,
          Priority: r.priority,
          Severity: r.severity,
          Preconditions: r.preconditions,
          "Test Steps": r.steps,
          "Expected Result": r.expectedResult,
          "Test Data": r.testData,
        })),
        baseName: "test_cases",
        sheetName: "Test Cases",
      };
    }
    case "bug_reports": {
      const rows = await prisma.bugReport.findMany({
        where: { projectId },
        orderBy: { bugId: "asc" },
      });
      return {
        rows: rows.map((r) => ({
          "Bug ID": r.bugId,
          Title: r.title,
          Description: r.description,
          "Steps to Reproduce": r.stepsToReproduce,
          "Expected Result": r.expectedResult,
          "Actual Result": r.actualResult,
          Severity: r.severity,
          Priority: r.priority,
          Environment: r.environment,
          "Root Cause Suggestion": r.rootCauseSuggestion,
          "Source Test Case": r.sourceTestCase,
          Status: r.status,
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

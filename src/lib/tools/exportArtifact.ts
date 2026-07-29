import path from "node:path";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { getDb } from "../db";
import { projectExportsDir } from "../paths";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeSheet(rows: Record<string, unknown>[], sheetName: string, filePath: string) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  // XLSX.writeFile() does its own environment feature-detection to decide how
  // to save, which misbehaves under Next.js/Turbopack bundling ("cannot save
  // file"). Getting a Buffer and writing it ourselves sidesteps that entirely.
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  fs.writeFileSync(filePath, buffer);
}

export type ExportKind = "requirements" | "test_cases" | "benchmark" | "bug_reports";

function rowsForKind(db: ReturnType<typeof getDb>, projectId: string, kind: ExportKind) {
  switch (kind) {
    case "requirements":
      return {
        rows: db
          .prepare(
            `SELECT req_id AS "Requirement ID", req_type AS "Type", description AS "Description",
                    CASE is_assumption WHEN 1 THEN 'Yes' ELSE 'No' END AS "Assumption",
                    source_document AS "Source Document"
             FROM requirements WHERE project_id = ? ORDER BY req_id`
          )
          .all(projectId) as Record<string, unknown>[],
        baseName: "requirements_rtm",
        sheetName: "Requirements",
      };
    case "test_cases":
      return {
        rows: db
          .prepare(
            `SELECT case_id AS "Test Case ID", source_requirement AS "Requirement Mapping",
                    module AS "Module", test_type AS "Test Type", priority AS "Priority",
                    severity AS "Severity", preconditions AS "Preconditions", steps AS "Test Steps",
                    expected_result AS "Expected Result", test_data AS "Test Data"
             FROM test_cases WHERE project_id = ? ORDER BY case_id`
          )
          .all(projectId) as Record<string, unknown>[],
        baseName: "test_cases",
        sheetName: "Test Cases",
      };
    case "bug_reports":
      return {
        rows: db
          .prepare(
            `SELECT bug_id AS "Bug ID", title AS "Title", description AS "Description",
                    steps_to_reproduce AS "Steps to Reproduce", expected_result AS "Expected Result",
                    actual_result AS "Actual Result", severity AS "Severity", priority AS "Priority",
                    environment AS "Environment", root_cause_suggestion AS "Root Cause Suggestion",
                    source_test_case AS "Source Test Case", status AS "Status"
             FROM bug_reports WHERE project_id = ? ORDER BY bug_id`
          )
          .all(projectId) as Record<string, unknown>[],
        baseName: "bug_reports",
        sheetName: "Bug Reports",
      };
    case "benchmark":
      return {
        rows: db
          .prepare(
            `SELECT s_no AS "S.No", agent AS "Agent", question AS "Question",
                    query_category AS "Query Category", scenario_type AS "Scenario Type",
                    expected_answer AS "Expected Answer", answer_in_testing AS "Answer in Testing",
                    score AS "Score", source_document AS "Source Document",
                    notes AS "Notes / Edge Flag", pass_fail AS "Pass / Fail"
             FROM benchmark_rows WHERE project_id = ? ORDER BY s_no`
          )
          .all(projectId) as Record<string, unknown>[],
        baseName: "benchmark_dataset",
        sheetName: "Benchmark",
      };
  }
}

export function exportProjectArtifact(
  projectId: string,
  kind: ExportKind
): { fileName: string; filePath: string; rowCount: number } {
  const db = getDb();
  const { rows, baseName, sheetName } = rowsForKind(db, projectId, kind);

  if (rows.length === 0) {
    throw new Error(
      `No ${kind.replace("_", " ")} saved yet for this project — nothing to export.`
    );
  }

  const fileName = `${timestamp()}_${baseName}.xlsx`;
  const filePath = path.join(projectExportsDir(projectId), fileName);
  writeSheet(rows, sheetName, filePath);

  return { fileName, filePath, rowCount: rows.length };
}

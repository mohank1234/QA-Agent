import { NextResponse } from "next/server";
import { listExecutionHistory } from "@/lib/db";
import { evidenceUrlFromKey } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";

const CLASSIFICATION_LABELS: Record<string, string> = {
  PASS: "Pass",
  ASSERTION_FAIL: "Assertion fail",
  APP_ERROR: "App error",
  SCRIPT_ERROR: "Script error",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;
  // Flattened to one row per execution so the Executions tab can render it as
  // a flat table like every other tab, rather than a nested run/execution
  // structure the shared DataTable has no way to display.
  const runs = await listExecutionHistory(projectId!, { limit: 50 });
  const rows = runs.flatMap((run) =>
    run.executions.map((e) => ({
      run_label: run.label,
      run_status: run.status,
      started_at: run.started_at,
      case_id: e.case_id,
      result: e.passed ? "Pass" : "Fail",
      // Left blank on a pass: "PASS" in a Cause column is noise, and the point
      // of the column is to tell apart the three ways a run can go red.
      // Executions recorded before classification existed also have none, and
      // showing an empty cell is honest where inventing one would not be.
      //
      // Humanised on the way out: SCREAMING_SNAKE_CASE is how the classifier
      // and the database name these, and it should stay that way in both — but
      // it is an internal identifier, and a QA lead reading a results table
      // shouldn't have to parse a constant.
      classification: e.passed ? "" : CLASSIFICATION_LABELS[e.classification ?? ""] ?? "",
      classification_reason: e.passed ? "" : (e.classification_reason ?? ""),
      // Shown as the actual substitution rather than a bare "yes": a heal that
      // can't be audited is just a test that silently rewrote itself.
      self_healed: e.healed
        ? `${e.healed_from_locator ?? "?"} → ${e.healed_to_locator ?? "?"}`
        : "",
      actual_result: e.actual_result,
      error_message: e.error_message,
      duration_ms: e.duration_ms,
      executed_at: e.executed_at,
      evidence: e.evidence.map((a) => ({ ...a, url: evidenceUrlFromKey(a.key) })),
    }))
  );
  return NextResponse.json({ executions: rows });
}

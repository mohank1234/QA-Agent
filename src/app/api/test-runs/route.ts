import { NextResponse } from "next/server";
import { listExecutionHistory } from "@/lib/db";
import { evidenceUrlFromKey } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";

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
      actual_result: e.actual_result,
      error_message: e.error_message,
      duration_ms: e.duration_ms,
      executed_at: e.executed_at,
      evidence: e.evidence.map((a) => ({ ...a, url: evidenceUrlFromKey(a.key) })),
    }))
  );
  return NextResponse.json({ executions: rows });
}

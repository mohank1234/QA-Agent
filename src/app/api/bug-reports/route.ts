import { NextResponse } from "next/server";
import { listBugReportsForProject } from "@/lib/db";
import { evidenceUrlFromKey } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;
  const bugs = await listBugReportsForProject(projectId!);
  // Attachments are stored as storage keys; the UI needs the route that
  // serves them. Resolved here rather than at write time so a key stays the
  // single source of truth and the URL scheme can change freely.
  return NextResponse.json({
    bugReports: bugs.map((b) => ({
      ...b,
      attachments: b.attachments.map((a) => ({ ...a, url: evidenceUrlFromKey(a.key) })),
    })),
  });
}

import { NextResponse } from "next/server";
import { listBugReportsForProject } from "@/lib/db";
import { requireProjectAccess } from "@/lib/apiAuth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;
  return NextResponse.json({ bugReports: await listBugReportsForProject(projectId!) });
}

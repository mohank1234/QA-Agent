import { NextResponse } from "next/server";
import { listGeneratedDocuments, getProject } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 400 });
  }
  return NextResponse.json({ documents: listGeneratedDocuments(projectId) });
}

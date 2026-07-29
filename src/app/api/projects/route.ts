import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { listProjects, createProject, getProject, deleteProject } from "@/lib/db";
import { projectUploadsDir, projectExportsDir, projectGeneratedDocsDir } from "@/lib/paths";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }
  const project = createProject(name);
  return NextResponse.json({ project });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 400 });
  }

  deleteProject(projectId);
  await Promise.all([
    fs.rm(projectUploadsDir(projectId), { recursive: true, force: true }),
    fs.rm(projectExportsDir(projectId), { recursive: true, force: true }),
    fs.rm(projectGeneratedDocsDir(projectId), { recursive: true, force: true }),
  ]);

  return NextResponse.json({ ok: true });
}

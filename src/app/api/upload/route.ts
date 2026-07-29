import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { addDocument, getProject } from "@/lib/db";
import { projectUploadsDir } from "@/lib/paths";

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".csv",
  ".pptx",
  ".txt",
  ".md",
]);

export async function POST(req: Request) {
  const formData = await req.formData();
  const projectId = formData.get("projectId");
  const file = formData.get("file");

  if (typeof projectId !== "string" || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      {
        error: `Unsupported file type "${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      },
      { status: 400 }
    );
  }

  const safeName = path.basename(file.name);
  const destDir = projectUploadsDir(projectId);
  const destPath = path.join(destDir, safeName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destPath, buffer);
  const doc = addDocument(projectId, safeName, destPath);

  return NextResponse.json({ filename: safeName, id: doc.id, uploadedAt: doc.uploadedAt });
}

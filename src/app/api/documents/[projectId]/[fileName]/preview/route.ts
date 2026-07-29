import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { projectUploadsDir } from "@/lib/paths";
import { extractDocumentText } from "@/lib/tools/readDocument";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;
  const dir = projectUploadsDir(projectId);
  const safeName = path.basename(fileName);
  const filePath = path.join(dir, safeName);

  if (!filePath.startsWith(dir)) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  try {
    await fs.access(filePath);
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  try {
    const text = await extractDocumentText(filePath);
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

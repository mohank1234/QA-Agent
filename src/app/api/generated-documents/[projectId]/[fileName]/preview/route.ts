import { NextResponse } from "next/server";
import path from "node:path";
import { getGeneratedDocumentContent } from "@/lib/db";
import { requireProjectAccess } from "@/lib/apiAuth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;

  const safeName = path.basename(fileName);
  const content = await getGeneratedDocumentContent(projectId, safeName);
  if (content === undefined) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  return NextResponse.json({ text: content });
}

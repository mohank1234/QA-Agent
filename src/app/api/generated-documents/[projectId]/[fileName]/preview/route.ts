import { NextResponse } from "next/server";
import path from "node:path";
import { getGeneratedDocumentContent } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;
  const safeName = path.basename(fileName);
  const content = getGeneratedDocumentContent(projectId, safeName);
  if (content === undefined) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  return NextResponse.json({ text: content });
}

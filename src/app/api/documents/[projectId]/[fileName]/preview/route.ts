import { NextResponse } from "next/server";
import { uploadKey, getObject } from "@/lib/storage";
import { extractDocumentText } from "@/lib/tools/readDocument";
import { requireProjectAccess } from "@/lib/apiAuth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;

  const data = await getObject(uploadKey(projectId, fileName));
  if (!data) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  try {
    const text = await extractDocumentText(data, fileName);
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

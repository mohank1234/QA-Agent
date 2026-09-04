import { NextResponse } from "next/server";
import { uploadKey, getObject } from "@/lib/storage";
import { extractDocumentText, isImageFile, imageMimeType } from "@/lib/tools/readDocument";
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

  // An image has nothing to extract as text — there's no JSON shape that
  // makes sense here, so this branch returns the raw bytes directly, with
  // `inline` (not `attachment`) so <img src="this URL"> just renders it.
  if (isImageFile(fileName)) {
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": imageMimeType(fileName) ?? "application/octet-stream",
        "Content-Disposition": "inline",
      },
    });
  }

  try {
    const text = await extractDocumentText(data, fileName);
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

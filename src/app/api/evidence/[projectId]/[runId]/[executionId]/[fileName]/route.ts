import { NextResponse } from "next/server";
import path from "node:path";
import { runEvidenceKey, getObject } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";

// Content types for the fixed set of artifacts the harness produces. Anything
// not on this list is refused rather than served with a guessed type — the
// path segments come from a URL, so this doubles as an allow-list against
// someone probing for other objects under the project's evidence prefix.
const CONTENT_TYPES: Record<string, { type: string; inline: boolean }> = {
  "screenshot.png": { type: "image/png", inline: true },
  "video.webm": { type: "video/webm", inline: true },
  "console.log": { type: "text/plain; charset=utf-8", inline: true },
  "network.har": { type: "application/json", inline: false },
  "trace.zip": { type: "application/zip", inline: false },
};

export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; runId: string; executionId: string; fileName: string }> }
) {
  const { projectId, runId, executionId, fileName } = await params;
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;

  const safeName = path.basename(fileName);
  const meta = CONTENT_TYPES[safeName];
  if (!meta) {
    return NextResponse.json({ error: "Unknown evidence artifact." }, { status: 404 });
  }

  const data = await getObject(runEvidenceKey(projectId, runId, executionId, safeName));
  if (!data) {
    return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.type,
      "Content-Disposition": `${meta.inline ? "inline" : "attachment"}; filename="${safeName}"`,
    },
  });
}

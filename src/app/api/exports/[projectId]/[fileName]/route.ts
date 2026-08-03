import { NextResponse } from "next/server";
import path from "node:path";
import { exportKey, getObject } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> }
) {
  const { projectId, fileName } = await params;
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;

  const safeName = path.basename(fileName);
  const data = await getObject(exportKey(projectId, fileName));
  if (!data) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  });
}

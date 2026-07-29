import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { projectUploadsDir } from "@/lib/paths";

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
    const data = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}

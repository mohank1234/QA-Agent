import { NextResponse } from "next/server";
import path from "node:path";
import { addDocument } from "@/lib/db";
import { uploadKey, putObject } from "@/lib/storage";
import { requireProjectAccess } from "@/lib/apiAuth";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";

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

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — generous for BRDs/specs, small enough to bound memory abuse

export async function POST(req: Request) {
  const formData = await req.formData();
  const projectId = formData.get("projectId");
  const file = formData.get("file");

  const access = await requireProjectAccess(typeof projectId === "string" ? projectId : null);
  if (!access.ok) return access.response;

  const limit = checkRateLimit(`upload:${access.userId}`, 30, 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  // Same reasoning as chat's guest hourly cap: the per-minute limit alone
  // doesn't bound total storage usage from one anonymous visitor over their
  // whole 1-hour project lifetime (30/min * 60min * up to 25MB each adds up
  // fast). 10/hour, keyed by both guestId and IP.
  if (access.isGuest) {
    const hourlyByGuest = checkRateLimit(`upload-guest-hourly:${access.userId}`, 10, 60 * 60 * 1000);
    if (!hourlyByGuest.allowed) return rateLimitResponse(hourlyByGuest.retryAfterSeconds);
    const hourlyByIp = checkRateLimit(`upload-guest-hourly-ip:${clientIp(req)}`, 10, 60 * 60 * 1000);
    if (!hourlyByIp.allowed) return rateLimitResponse(hourlyByIp.retryAfterSeconds);
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large — max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` },
      { status: 413 }
    );
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
  const key = uploadKey(projectId as string, file.name);

  const buffer = Buffer.from(await file.arrayBuffer());
  await putObject(key, buffer, file.type || undefined);
  const doc = await addDocument(projectId as string, safeName, key);

  return NextResponse.json({ filename: safeName, id: doc.id, uploadedAt: doc.uploadedAt });
}

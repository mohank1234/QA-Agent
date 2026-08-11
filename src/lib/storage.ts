import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import path from "node:path";
import { config } from "./config";
import { logger } from "./logger";

// Cloudflare R2 is S3-compatible, so the standard AWS SDK works against it
// with just a different endpoint. Object storage for the 3 file categories
// this app produces: uploaded documents, .xlsx exports, generated .docx
// files. Replaces what used to be local disk under data/ — see
// docs/BUILD_JOURNAL.md for why (Vercel's serverless functions have no
// persistent disk between invocations).
const client = new S3Client({
  region: "auto",
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

const BUCKET = config.r2.bucketName;

// path.basename strips any directory components from a filename before it
// becomes part of an object key — same reasoning as the old resolveSafePath:
// without it, a crafted filename containing "/" could land an upload under
// a different project's prefix instead of its own.
function safeFileName(fileName: string): string {
  return path.basename(fileName);
}

export function uploadKey(projectId: string, fileName: string): string {
  return `uploads/${projectId}/${safeFileName(fileName)}`;
}
export function exportKey(projectId: string, fileName: string): string {
  return `exports/${projectId}/${safeFileName(fileName)}`;
}
export function generatedDocKey(projectId: string, fileName: string): string {
  return `generated/${projectId}/${safeFileName(fileName)}`;
}
// Test evidence (Playwright trace, screenshot, console log, HAR, video).
// Namespaced by project first — like every other prefix here — so a project's
// whole evidence tree can be deleted with it, then by run and execution so a
// single execution's artifacts stay grouped.
export function runEvidenceKey(
  projectId: string,
  runId: string,
  executionId: string,
  fileName: string
): string {
  return `runs/${projectId}/${safeFileName(runId)}/${safeFileName(executionId)}/${safeFileName(fileName)}`;
}

// Saved Playwright storageState (cookies + localStorage for an authenticated
// session), reused across runs so a suite logs in once instead of per test.
// Deliberately NOT under runs/ — a session outlives the run that created it,
// and must not be swept away with that run's evidence. It IS under the
// project prefix, so it still dies with the project.
export function sessionStateKey(projectId: string, name: string): string {
  return `sessions/${projectId}/${safeFileName(name)}.json`;
}

// Turns a stored evidence key back into the route that serves it. Kept next to
// runEvidenceKey so the two can't drift: the route's path segments are exactly
// the key's, minus the "runs/" prefix.
export function evidenceUrlFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts.length !== 5 || parts[0] !== "runs") return null;
  const [, projectId, runId, executionId, fileName] = parts;
  return `/api/evidence/${projectId}/${runId}/${executionId}/${fileName}`;
}

export async function putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

// Returns null for a missing object (not found) rather than throwing, so
// callers can turn it into a normal 404 the same way a missing local file
// used to.
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

// Used on project deletion — removes every object under a prefix (all of a
// project's uploads, or exports, or generated docs). Paginated: R2 caps
// ListObjectsV2 at 1000 keys per page, same as S3.
export async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const objects = (list.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k)
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects } }));
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  logger.info({ prefix }, "deleted R2 objects with prefix");
}

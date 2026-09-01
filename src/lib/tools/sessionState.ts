import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getObject, sessionStateKey } from "../storage";

// Stored browser sessions, shared by everything that opens a browser.
//
// This lives in its own module rather than in executeTests because both test
// execution and page inspection need it, and having inspection import from the
// execution module (which in turn needs inspection, for self-healing) would be
// a circular import. A storage helper belongs to neither caller.

/**
 * Pulls a stored session down to a local file the harness can hand to
 * Playwright's storageState. Returns null when the session doesn't exist yet —
 * a missing session is a normal first-run state, and the caller simply starts
 * logged out rather than failing.
 *
 * The caller owns the returned directory and must remove it when done.
 */
export async function materializeSession(
  projectId: string,
  name: string
): Promise<{ path: string; dir: string } | null> {
  const body = await getObject(sessionStateKey(projectId, name));
  if (!body) return null;
  const dir = path.join(os.tmpdir(), `qa-agent-session-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "storage-state.json");
  await fs.writeFile(file, body);
  return { path: file, dir };
}

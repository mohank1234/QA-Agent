import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const MAX_OUTPUT_CHARS = 20_000;
export const RESULT_MARKER = "__QA_AGENT_RESULT__";

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS
    ? s.slice(0, MAX_OUTPUT_CHARS) + "\n[...output truncated...]"
    : s;
}

export type ScriptResult = {
  passed: boolean;
  error?: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * Runs a self-contained Node harness source string (must write
 * `RESULT_MARKER + JSON.stringify({passed, error?})` to stdout as its last
 * action) in a separate child process with a hard timeout and its own temp
 * working directory. This is process isolation (crash/hang containment, cwd
 * scoping) — NOT a hardened security sandbox. The script runs as plain Node
 * with this user's OS privileges. Acceptable here because the script is
 * authored by this agent on the user's own behalf, not by an untrusted
 * third party.
 */
export async function runNodeHarness(
  harnessSource: string,
  timeoutMs: number
): Promise<ScriptResult> {
  const runDir = path.join(os.tmpdir(), `qa-agent-run-${randomUUID()}`);
  await fs.mkdir(runDir, { recursive: true });
  const scriptPath = path.join(runDir, "harness.cjs");
  await fs.writeFile(scriptPath, harnessSource);

  try {
    return await new Promise<ScriptResult>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd: runDir,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          passed: false,
          error: `Failed to start script process: ${err.message}`,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          timedOut: false,
        });
      });

      child.on("close", () => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            passed: false,
            error: `Script timed out after ${timeoutMs}ms and was killed.`,
            stdout: truncate(stdout),
            stderr: truncate(stderr),
            timedOut: true,
          });
          return;
        }

        const markerIndex = stdout.indexOf(RESULT_MARKER);
        if (markerIndex === -1) {
          resolve({
            passed: false,
            error: "Script did not complete normally (no result marker found) — see stderr.",
            stdout: truncate(stdout),
            stderr: truncate(stderr),
            timedOut: false,
          });
          return;
        }

        try {
          const jsonText = stdout.slice(markerIndex + RESULT_MARKER.length).trim().split("\n")[0];
          const parsed = JSON.parse(jsonText) as { passed: boolean; error?: string };
          resolve({
            passed: parsed.passed,
            error: parsed.error,
            stdout: truncate(stdout.slice(0, markerIndex)),
            stderr: truncate(stderr),
            timedOut: false,
          });
        } catch {
          resolve({
            passed: false,
            error: "Could not parse script result.",
            stdout: truncate(stdout),
            stderr: truncate(stderr),
            timedOut: false,
          });
        }
      });
    });
  } finally {
    // Windows can briefly hold a file handle open right after the child
    // process exits (e.g. AV real-time scan of the script that just ran),
    // so a single rm attempt occasionally leaves an empty temp dir behind.
    // Retry a couple of times before giving up silently.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rm(runDir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
}

import { runNodeHarness, RESULT_MARKER, type ScriptResult } from "./scriptRunner";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

function buildHarness(script: string): string {
  return `
function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

(async () => {
  try {
    await (async () => {
${script}
    })();
    process.stdout.write("\\n${RESULT_MARKER}" + JSON.stringify({ passed: true }) + "\\n");
  } catch (err) {
    process.stdout.write("\\n${RESULT_MARKER}" + JSON.stringify({ passed: false, error: err && err.message ? err.message : String(err) }) + "\\n");
  }
})();
`;
}

export type ApiTestResult = ScriptResult;

/**
 * Runs an LLM-written API test body with Node's global `fetch` and an
 * `assert(condition, message)` helper available. No Java/Postman/newman
 * needed — this covers what REST Assured/Postman collections would give you
 * with a much lighter runtime.
 */
export async function runApiTestScript(
  script: string,
  timeoutMs?: number
): Promise<ApiTestResult> {
  const effectiveTimeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  return runNodeHarness(buildHarness(script), effectiveTimeout);
}

import { runNodeHarness, RESULT_MARKER, type ScriptResult } from "./scriptRunner";

const DEFAULT_TIMEOUT_MS = 30_000;
// Same two-ceiling split as the browser runner: an API test executed inside
// the chat request has to finish quickly, but a detached one may legitimately
// wait — e.g. polling an endpoint across a token-refresh or session-expiry
// window, which is part of the idle-timeout feature set.
const MAX_INLINE_TIMEOUT_MS = 60_000;
const MAX_BACKGROUND_TIMEOUT_MS = 45 * 60_000;

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
  timeoutMs?: number,
  options: { allowLongTimeout?: boolean } = {}
): Promise<ApiTestResult> {
  const ceiling = options.allowLongTimeout ? MAX_BACKGROUND_TIMEOUT_MS : MAX_INLINE_TIMEOUT_MS;
  const effectiveTimeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, ceiling);
  return runNodeHarness(buildHarness(script), effectiveTimeout);
}

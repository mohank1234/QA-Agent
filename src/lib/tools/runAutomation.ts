import fs from "node:fs/promises";
import path from "node:path";
import { runNodeHarness, RESULT_MARKER, type ScriptResult } from "./scriptRunner";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;

function buildHarness(playwrightEntry: string, url: string | undefined, script: string): string {
  const navigate = url
    ? `await page.goto(${JSON.stringify(url)}, { waitUntil: "load", timeout: 30000 });`
    : "";
  return `
const { chromium } = require(${JSON.stringify(playwrightEntry)});

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    ${navigate}
    await (async () => {
${script}
    })();
    process.stdout.write("\\n${RESULT_MARKER}" + JSON.stringify({ passed: true }) + "\\n");
  } catch (err) {
    process.stdout.write("\\n${RESULT_MARKER}" + JSON.stringify({ passed: false, error: err && err.message ? err.message : String(err) }) + "\\n");
  } finally {
    await browser.close().catch(() => {});
  }
})();
`;
}

export type AutomationResult = ScriptResult;

export async function runPlaywrightScript(
  script: string,
  options: { url?: string; timeoutMs?: number } = {}
): Promise<AutomationResult> {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  // NOT require.resolve("playwright") here: under Next.js/Turbopack this
  // server module is bundled, and Turbopack rewrites require.resolve() of an
  // externalized package into its own internal placeholder string (looks
  // like "[externals]/playwright [external] (...)"), not a real filesystem
  // path — which then fails when handed to a plain `node` child process.
  // Resolving straight off process.cwd() (the project root) sidesteps the
  // bundler entirely.
  const playwrightEntry = path.join(process.cwd(), "node_modules", "playwright");
  try {
    await fs.access(playwrightEntry);
  } catch {
    throw new Error(
      `Could not find the playwright package at ${playwrightEntry} — run "npm install playwright" in the project root.`
    );
  }

  return runNodeHarness(buildHarness(playwrightEntry, options.url, script), timeoutMs);
}

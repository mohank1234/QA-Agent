import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runNodeHarness, RESULT_MARKER, type ScriptResult } from "./scriptRunner";

const DEFAULT_TIMEOUT_MS = 60_000;

// Two ceilings, because there are two very different situations.
//
// INLINE is for a test executed inside an HTTP request the user is waiting on
// (the chat turn). /api/chat declares maxDuration = 60, and any hosting layer
// will eventually cut a long request off, so a test run inline has to stay
// short.
//
// BACKGROUND is for a detached run nothing is waiting on. Idle/session-timeout
// testing is the reason this exists: verifying a 15- or 30-minute timeout
// requires actually waiting that long, which no request-bound model can do.
export const MAX_INLINE_TIMEOUT_MS = 180_000; // 3 minutes
export const MAX_BACKGROUND_TIMEOUT_MS = 45 * 60_000; // 45 minutes

export const SESSION_STATE_FILE = "storage-state.json";

// File names the harness writes into the evidence directory. The parent finds
// artifacts by checking for these rather than parsing them out of the child's
// result payload — a crashed or killed child can still leave usable evidence
// behind, and file existence is the honest test of whether it did.
export const EVIDENCE_FILES = {
  trace: "trace.zip",
  screenshot: "screenshot.png",
  console: "console.log",
  har: "network.har",
  video: "video.webm",
} as const;

export type EvidenceArtifacts = {
  /** Absolute path to the directory holding whatever was captured. */
  dir: string;
  trace?: string;
  screenshot?: string;
  console?: string;
  har?: string;
  video?: string;
};

function buildHarness(
  playwrightEntry: string,
  url: string | undefined,
  script: string,
  evidenceDir: string,
  sessionStatePath: string | undefined,
  saveSessionState: boolean
): string {
  const navigate = url
    ? `await page.goto(${JSON.stringify(url)}, { waitUntil: "load", timeout: 30000 });`
    : "";

  // Everything below runs inside the child process. Paths are injected as JSON
  // literals so a Windows path's backslashes can't corrupt the source.
  return `
const { chromium } = require(${JSON.stringify(playwrightEntry)});
const fs = require("node:fs");
const path = require("node:path");

const EVIDENCE_DIR = ${JSON.stringify(evidenceDir)};
const VIDEO_DIR = path.join(EVIDENCE_DIR, "video");
const SESSION_IN = ${sessionStatePath ? JSON.stringify(sessionStatePath) : "null"};
const SESSION_OUT = ${saveSessionState ? JSON.stringify(path.join(evidenceDir, SESSION_STATE_FILE)) : "null"};

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });

  const consoleLines = [];
  const browser = await chromium.launch();
  let passed = false;
  let errorMessage = null;
  let context = null;
  let page = null;
  // Contexts the script opened itself, tracked so they can be closed even if
  // the script throws midway — an unclosed context keeps the process alive.
  const extraContexts = [];

  // Console/network capture is wired per page, and attached automatically to
  // every page a context opens (including popups and script-opened tabs), so
  // a multi-tab test's log isn't silently limited to the first tab.
  //
  // Attached ONLY from the context's "page" event — never also by hand for the
  // first page, which would register two listeners on it and duplicate every
  // one of its lines in the log.
  let tabCount = 0;
  function watch(p, tag) {
    p.on("console", (msg) => {
      consoleLines.push(new Date().toISOString() + " [" + tag + "] [" + msg.type() + "] " + msg.text());
    });
    p.on("pageerror", (err) => {
      consoleLines.push(new Date().toISOString() + " [" + tag + "] [pageerror] " + (err && err.message ? err.message : String(err)));
    });
    p.on("requestfailed", (req) => {
      const f = req.failure();
      consoleLines.push(
        new Date().toISOString() + " [" + tag + "] [requestfailed] " + req.method() + " " + req.url() +
        (f && f.errorText ? " - " + f.errorText : "")
      );
    });
  }

  try {
    const baseOptions = {
      // HAR and video must be configured at context creation — they cannot be
      // switched on later, so they are always recorded and then discarded by
      // the parent when the test passes.
      recordHar: { path: path.join(EVIDENCE_DIR, ${JSON.stringify(EVIDENCE_FILES.har)}), content: "embed" },
      recordVideo: { dir: VIDEO_DIR },
    };
    if (SESSION_IN) baseOptions.storageState = SESSION_IN;

    context = await browser.newContext(baseOptions);
    // Registered before the first newPage() so page 1 is covered by it too.
    // Tags come from a counter rather than pages().length, which would
    // misnumber tabs once any of them is closed.
    context.on("page", (p) => watch(p, "tab" + ++tabCount));

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    page = await context.newPage();

    // --- Helpers available to the test body -----------------------------
    //
    // newPage() opens another TAB in the SAME context: shares cookies,
    // storage, and the logged-in session. This is what multi-tab behaviour
    // testing needs — two tabs of one logged-in user.
    //
    // newContext() opens a fully ISOLATED session: separate cookies and
    // storage, like a different browser profile. Use it for concurrent
    // logins or for verifying that one session's expiry doesn't affect
    // another's.
    //
    // Background-tab behaviour: a tab that isn't focused. bringToFront() on
    // another page is what actually backgrounds this one, which is how you
    // test whether timers/keepalives keep running when a tab loses focus.
    const newPage = async () => {
      const p = await context.newPage();
      return p;
    };
    const newContext = async (opts) => {
      const c = await browser.newContext(opts || {});
      extraContexts.push(c);
      const n = extraContexts.length;
      let ctxTabs = 0;
      c.on("page", (p) => watch(p, "ctx" + n + "-tab" + ++ctxTabs));
      return c;
    };

    ${navigate}
    await (async () => {
${script}
    })();
    passed = true;
  } catch (err) {
    errorMessage = err && err.message ? err.message : String(err);
    // Screenshot while the page is still open — after context.close() there is
    // nothing left to photograph. Best-effort: if the page already crashed,
    // losing the screenshot must not also lose the test result.
    if (page) {
      try {
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, ${JSON.stringify(EVIDENCE_FILES.screenshot)}),
          fullPage: true,
        });
      } catch (e) {}
    }
  } finally {
    // Session state is captured BEFORE anything closes — storageState() needs
    // a live context. Saved even when the test failed: a login step that
    // succeeded before a later assertion failed still produced a usable
    // session, and discarding it would force the next test to log in again.
    if (SESSION_OUT && context) {
      try {
        await context.storageState({ path: SESSION_OUT });
      } catch (e) {}
    }

    // Contexts the script opened itself. Closed first so nothing keeps the
    // browser (and therefore this process) alive past the test.
    for (const c of extraContexts) {
      try {
        await c.close();
      } catch (e) {}
    }

    // Order matters: stop tracing before closing the context, then close the
    // context (which is what flushes the HAR and finalizes the video), then
    // resolve the video path.
    if (context) {
      try {
        await context.tracing.stop({ path: path.join(EVIDENCE_DIR, ${JSON.stringify(EVIDENCE_FILES.trace)}) });
      } catch (e) {}

      let video = null;
      try {
        video = page ? page.video() : null;
      } catch (e) {}

      try {
        await context.close();
      } catch (e) {}

      if (video) {
        try {
          await video.saveAs(path.join(EVIDENCE_DIR, ${JSON.stringify(EVIDENCE_FILES.video)}));
        } catch (e) {}
      }
    }

    try {
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, ${JSON.stringify(EVIDENCE_FILES.console)}),
        consoleLines.length > 0 ? consoleLines.join("\\n") + "\\n" : "(no console output)\\n"
      );
    } catch (e) {}

    try {
      await browser.close();
    } catch (e) {}

    process.stdout.write(
      "\\n${RESULT_MARKER}" +
        JSON.stringify(passed ? { passed: true } : { passed: false, error: errorMessage }) +
        "\\n"
    );
  }
})();
`;
}

export type AutomationResult = ScriptResult & {
  evidence?: EvidenceArtifacts;
  /** Local path to the storageState written by this run, if one was asked for. */
  savedSessionStatePath?: string;
};

async function exists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    // Zero-byte artifacts are worse than none: they upload cleanly and then
    // disappoint whoever opens them. Treat them as not produced.
    return stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Collects whatever the harness actually managed to write. Everything is
 * optional by design — an aborted run still yields whatever it got to.
 */
async function collectEvidence(dir: string, passed: boolean): Promise<EvidenceArtifacts> {
  const at = (name: string) => path.join(dir, name);
  const evidence: EvidenceArtifacts = { dir };

  if (await exists(at(EVIDENCE_FILES.trace))) evidence.trace = at(EVIDENCE_FILES.trace);
  if (await exists(at(EVIDENCE_FILES.console))) evidence.console = at(EVIDENCE_FILES.console);
  if (await exists(at(EVIDENCE_FILES.screenshot))) evidence.screenshot = at(EVIDENCE_FILES.screenshot);

  // HAR and video are recorded unconditionally (they can only be enabled at
  // context creation) but only kept when the test fails — on a pass they are
  // bulk nobody reads, and this runs against a metered object store.
  if (passed) {
    await fs.rm(at(EVIDENCE_FILES.har), { force: true }).catch(() => {});
    await fs.rm(at(EVIDENCE_FILES.video), { force: true }).catch(() => {});
  } else {
    if (await exists(at(EVIDENCE_FILES.har))) evidence.har = at(EVIDENCE_FILES.har);
    if (await exists(at(EVIDENCE_FILES.video))) evidence.video = at(EVIDENCE_FILES.video);
  }

  return evidence;
}

export async function runPlaywrightScript(
  script: string,
  options: {
    url?: string;
    timeoutMs?: number;
    /** Local path to a storageState JSON to start the context from. */
    sessionStatePath?: string;
    /** Write the context's storageState out at the end of the run. */
    saveSessionState?: boolean;
    /** Allow the long (background) ceiling instead of the request-safe one. */
    allowLongTimeout?: boolean;
  } = {}
): Promise<AutomationResult> {
  // VERCEL is set automatically in every Vercel deployment. Serverless
  // functions there don't have the ~300MB Chromium binary
  // `npx playwright install chromium` downloads locally (not bundled into
  // the deployment, and wouldn't fit typical function size limits anyway) —
  // fail with one clear, expected message here rather than a confusing
  // "executable doesn't exist" error surfacing from deep inside Playwright
  // once chromium.launch() actually attempts to run. Same graceful-degrade
  // pattern this app already uses for Selenium/Cypress/etc.
  if (process.env.VERCEL) {
    throw new Error(
      "Real browser test execution isn't available in this hosted environment (no Chromium binary here). I can still generate the Playwright script as text — say so if that's useful — or you can run it locally where this is fully supported."
    );
  }

  const ceiling = options.allowLongTimeout ? MAX_BACKGROUND_TIMEOUT_MS : MAX_INLINE_TIMEOUT_MS;
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ceiling);
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

  // Evidence lives outside the harness's own working directory, which
  // runNodeHarness deletes as soon as the child exits.
  const evidenceDir = path.join(os.tmpdir(), `qa-agent-evidence-${randomUUID()}`);
  await fs.mkdir(evidenceDir, { recursive: true });

  try {
    const result = await runNodeHarness(
      buildHarness(
        playwrightEntry,
        options.url,
        script,
        evidenceDir,
        options.sessionStatePath,
        options.saveSessionState === true
      ),
      timeoutMs
    );
    const evidence = await collectEvidence(evidenceDir, result.passed);
    const sessionOut = path.join(evidenceDir, SESSION_STATE_FILE);
    const savedSessionStatePath =
      options.saveSessionState && (await exists(sessionOut)) ? sessionOut : undefined;
    return { ...result, evidence, savedSessionStatePath };
  } catch (err) {
    await fs.rm(evidenceDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** Caller's responsibility once the artifacts have been uploaded. */
export async function discardEvidence(evidence: EvidenceArtifacts | undefined): Promise<void> {
  if (!evidence) return;
  await fs.rm(evidence.dir, { recursive: true, force: true }).catch(() => {});
}

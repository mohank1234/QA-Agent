import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runNodeHarness,
  RESULT_MARKER,
} from "./scriptRunner";
import { assertBrowserAvailable, resolvePlaywrightEntry } from "./runAutomation";
import { materializeSession } from "./sessionState";

// Why this tool exists: the agent used to author Playwright locators from spec
// prose alone, so every selector was a guess. First-pass runs failed on locator
// timeouts, and — worse — those failures could be written up as application
// defects when the only thing actually wrong was our own selector. Letting the
// agent look at the page before it writes the script removes the guessing.
//
// The output is deliberately a COMPACT structured snapshot, not a DOM dump.
// Every token spent here is a token not available for the test itself, so the
// budget matters more than completeness: interactive elements with a suggested
// locator each, plus enough page structure to orient. A full DOM would be more
// faithful and useless.

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 120_000;

/** Hard ceiling on returned elements. See the token-budget note above. */
export const MAX_ELEMENTS = 150;

const SNAPSHOT_FILE = "snapshot.json";

export type InspectedElement = {
  role: string;
  /** Approximated accessible name — see accName() in the harness. */
  name?: string;
  testId?: string;
  /**
   * Which attribute testId came from. Matters because Playwright's
   * getByTestId() resolves against `data-testid` and nothing else unless the
   * project configures testIdAttribute — a `data-test` value handed to
   * getByTestId silently matches nothing and fails as a timeout.
   */
  testIdAttribute?: string;
  domId?: string;
  /** The `name` attribute, which matters for form fields. */
  attrName?: string;
  inputType?: string;
  placeholder?: string;
  visible: boolean;
  enabled: boolean;
  /** Ready-to-paste Playwright locator, role/testid-first. */
  locator: string;
};

export type InspectedForm = {
  domId?: string;
  attrName?: string;
  action?: string;
  method?: string;
  /** Indexes into PageSnapshot.elements — avoids repeating each element. */
  elementIndexes: number[];
};

export type PageSnapshot = {
  title: string;
  requestedUrl: string;
  finalUrl: string;
  /** True when the final URL differs from the requested one. */
  redirected: boolean;
  headings: { level: number; text: string }[];
  landmarks: { role: string; text: string }[];
  forms: InspectedForm[];
  elements: InspectedElement[];
  /** How many interactive elements were found before the cap was applied. */
  totalInteractiveFound: number;
  truncated: boolean;
  notes: string[];
};

export type InspectPageOptions = {
  waitForSelector?: string;
  timeoutMs?: number;
  /** Name of a stored session, to inspect the page as a logged-in user. */
  authStateId?: string;
};

/**
 * The page-side extraction, injected into page.evaluate as source text.
 *
 * Locator preference order is deliberate and matches the rule the system prompt
 * gives the agent: getByTestId and getByRole first, because those survive
 * restyling and copy changes; CSS/id last, because an id in a component-framework
 * app is often generated and unstable. The point of returning a locator string
 * at all is that the agent should not be inventing one.
 */
const EXTRACT_SOURCE = `(MAX_ELEMENTS) => {
  const cap = (s, n) => {
    if (s === null || s === undefined) return undefined;
    const t = String(s).replace(/\\s+/g, " ").trim();
    if (!t) return undefined;
    return t.length > n ? t.slice(0, n) + "\\u2026" : t;
  };

  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "summary") return "button";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    return "generic";
  };

  // An approximation of accessible-name computation, not a spec-compliant one.
  // Ordered to match what Playwright's getByRole({ name }) will most often
  // resolve, so a suggested locator has a good chance of matching first try.
  const accName = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return cap(aria, 80);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const joined = labelledBy
        .split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent || "")
        .join(" ");
      if (joined.trim()) return cap(joined, 80);
    }

    if (el.id) {
      try {
        const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (forLabel && forLabel.textContent && forLabel.textContent.trim()) {
          return cap(forLabel.textContent, 80);
        }
      } catch (e) {}
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel && wrappingLabel.textContent && wrappingLabel.textContent.trim()) {
      return cap(wrappingLabel.textContent, 80);
    }

    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      // A button's visible text lives in value=, but for a text field value= is
      // whatever is currently typed — page state, not a name.
      if (type === "submit" || type === "button" || type === "reset") {
        const v = el.getAttribute("value");
        if (v && v.trim()) return cap(v, 80);
      }
      const ph = el.getAttribute("placeholder");
      if (ph && ph.trim()) return cap(ph, 80);
      const title = el.getAttribute("title");
      if (title && title.trim()) return cap(title, 80);
      return undefined;
    }

    return cap(el.textContent, 80);
  };

  // Single-quoted JS string literal, safe to paste into a locator call.
  const q = (s) => "'" + String(s).replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'") + "'";

  const suggestLocator = (el, role, name, testId, testIdAttribute) => {
    if (testId) {
      // getByTestId() is bound to data-testid by default. Emitting it for a
      // data-test / data-test-id value produces a locator that matches nothing
      // and fails as a locator timeout — indistinguishable, at a glance, from a
      // broken feature. Fall back to an explicit attribute selector instead.
      return testIdAttribute === "data-testid"
        ? "page.getByTestId(" + q(testId) + ")"
        : "page.locator(" + q("[" + testIdAttribute + '="' + testId + '"]') + ")";
    }
    if (role && role !== "generic" && name) {
      return "page.getByRole(" + q(role) + ", { name: " + q(name) + " })";
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return "page.getByPlaceholder(" + q(ph.trim()) + ")";
    if (name) return "page.getByLabel(" + q(name) + ")";
    if (el.id) return "page.locator(" + q("#" + el.id) + ")";
    const attrName = el.getAttribute("name");
    if (attrName) return "page.locator(" + q("[name=\\"" + attrName + "\\"]") + ")";
    if (role && role !== "generic") return "page.getByRole(" + q(role) + ")";
    return "page.locator(" + q(el.tagName.toLowerCase()) + ")";
  };

  const INTERACTIVE = [
    "a[href]", "button", "input", "select", "textarea", "summary",
    "[contenteditable=true]",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]",
    "[role=tab]", "[role=menuitem]", "[role=switch]", "[role=combobox]",
    "[role=searchbox]", "[role=textbox]", "[role=option]",
  ].join(",");

  // Ordered by Playwright-friendliness: data-testid is what getByTestId binds
  // to out of the box, so it wins when an element carries more than one.
  const TEST_ID_ATTRS = ["data-testid", "data-test-id", "data-test", "data-qa"];
  const testIdOf = (el) => {
    for (const attr of TEST_ID_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && value.trim()) return { value: value.trim(), attr };
    }
    return null;
  };

  const raw = Array.from(document.querySelectorAll(INTERACTIVE));
  const totalInteractiveFound = raw.length;

  // Visible first: an offscreen element is rarely what a test wants to drive,
  // and when the cap bites it should bite on the hidden ones.
  const ordered = raw
    .map((el) => ({ el, visible: isVisible(el) }))
    .sort((a, b) => (a.visible === b.visible ? 0 : a.visible ? -1 : 1))
    .slice(0, MAX_ELEMENTS);

  const nodeToIndex = new Map();
  const elements = ordered.map((entry, index) => {
    const el = entry.el;
    const role = roleOf(el);
    const name = accName(el);
    const testId = testIdOf(el);
    nodeToIndex.set(el, index);
    return {
      role,
      name,
      testId: testId ? testId.value : undefined,
      testIdAttribute: testId ? testId.attr : undefined,
      domId: el.id || undefined,
      attrName: el.getAttribute("name") || undefined,
      inputType: el.tagName.toLowerCase() === "input"
        ? (el.getAttribute("type") || "text").toLowerCase()
        : undefined,
      placeholder: cap(el.getAttribute("placeholder"), 60),
      visible: entry.visible,
      enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true",
      locator: suggestLocator(
        el,
        role,
        name,
        testId ? testId.value : undefined,
        testId ? testId.attr : undefined
      ),
    };
  });

  const forms = Array.from(document.querySelectorAll("form")).map((form) => {
    const elementIndexes = [];
    for (const [node, index] of nodeToIndex.entries()) {
      if (form.contains(node)) elementIndexes.push(index);
    }
    return {
      domId: form.id || undefined,
      attrName: form.getAttribute("name") || undefined,
      action: cap(form.getAttribute("action"), 120),
      method: (form.getAttribute("method") || undefined),
      elementIndexes: elementIndexes.sort((a, b) => a - b),
    };
  }).filter((f) => f.elementIndexes.length > 0 || f.domId || f.attrName);

  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter(isVisible)
    .slice(0, 40)
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: cap(h.textContent, 100) }))
    .filter((h) => h.text);

  const LANDMARKS = "main,nav,header,footer,aside,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=search],[role=alert],[role=dialog]";
  const landmarks = Array.from(document.querySelectorAll(LANDMARKS))
    .filter(isVisible)
    .slice(0, 12)
    .map((el) => ({
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      text: cap(el.textContent, 160),
    }))
    .filter((l) => l.text);

  return {
    title: document.title || "",
    headings,
    landmarks,
    forms,
    elements,
    totalInteractiveFound,
    truncated: totalInteractiveFound > MAX_ELEMENTS,
  };
}`;

function buildHarness(
  playwrightEntry: string,
  url: string,
  snapshotPath: string,
  sessionStatePath: string | undefined,
  waitForSelector: string | undefined,
  navTimeoutMs: number
): string {
  // Paths and user-supplied strings are injected as JSON literals so a Windows
  // path's backslashes (or a selector containing quotes) can't corrupt the
  // generated source — same convention as runAutomation's harness.
  return `
const { chromium } = require(${JSON.stringify(playwrightEntry)});
const fs = require("node:fs");

const SNAPSHOT_PATH = ${JSON.stringify(snapshotPath)};
const SESSION_IN = ${sessionStatePath ? JSON.stringify(sessionStatePath) : "null"};
const URL = ${JSON.stringify(url)};
const WAIT_FOR = ${waitForSelector ? JSON.stringify(waitForSelector) : "null"};
const NAV_TIMEOUT = ${navTimeoutMs};

(async () => {
  const browser = await chromium.launch();
  let ok = false;
  let errorMessage = null;
  let context = null;

  try {
    context = await browser.newContext(SESSION_IN ? { storageState: SESSION_IN } : {});
    const page = await context.newPage();

    const response = await page.goto(URL, { waitUntil: "load", timeout: NAV_TIMEOUT });

    // networkidle is requested as a settle step rather than as the goto
    // condition: as a goto condition it never resolves on a page holding a
    // websocket or a polling connection open, which would turn "inspect this
    // page" into a guaranteed timeout on exactly the modern apps this is for.
    // Best-effort — a page that never goes idle is still worth snapshotting.
    const notes = [];
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch (e) {
      notes.push("Page never reached network idle within 10s; snapshot taken anyway (long-polling or streaming connection is the usual cause).");
    }

    if (WAIT_FOR) {
      try {
        await page.waitForSelector(WAIT_FOR, { timeout: NAV_TIMEOUT });
      } catch (e) {
        notes.push("waitForSelector " + JSON.stringify(WAIT_FOR) + " never matched — the snapshot below may be of a page that hadn't finished rendering.");
      }
    }

    const status = response ? response.status() : null;
    if (status !== null && status >= 400) {
      notes.push("Page returned HTTP " + status + " — the snapshot may be of an error page rather than the intended one.");
    }

    const extracted = await page.evaluate(${EXTRACT_SOURCE}, ${MAX_ELEMENTS});

    const snapshot = Object.assign({}, extracted, {
      requestedUrl: URL,
      finalUrl: page.url(),
      redirected: page.url() !== URL,
      notes,
    });

    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));
    ok = true;
  } catch (err) {
    errorMessage = err && err.message ? err.message : String(err);
  } finally {
    if (context) {
      try { await context.close(); } catch (e) {}
    }
    try { await browser.close(); } catch (e) {}

    process.stdout.write(
      "\\n${RESULT_MARKER}" +
        JSON.stringify(ok ? { passed: true } : { passed: false, error: errorMessage }) +
        "\\n"
    );
  }
})();
`;
}

/**
 * Loads a page in headless Chromium and returns a compact structured snapshot
 * of what is actually on it.
 *
 * Runs through the same runNodeHarness child-process isolation as test
 * execution — deliberately not a second isolation model, so timeout, cleanup
 * and crash containment behave identically to a test run.
 */
export async function inspectPage(
  projectId: string,
  url: string,
  options: InspectPageOptions = {}
): Promise<PageSnapshot> {
  assertBrowserAvailable();
  const playwrightEntry = await resolvePlaywrightEntry();

  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  let session: { path: string; dir: string } | null = null;
  const notes: string[] = [];
  if (options.authStateId) {
    session = await materializeSession(projectId, options.authStateId);
    if (!session) {
      notes.push(
        `No saved session named "${options.authStateId}" yet — this page was inspected logged out, so anything behind authentication is missing from the snapshot.`
      );
    }
  }

  const workDir = path.join(os.tmpdir(), `qa-agent-inspect-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  const snapshotPath = path.join(workDir, SNAPSHOT_FILE);

  try {
    // The harness gets a slightly tighter navigation budget than the outer
    // process kill, so a slow page surfaces as a Playwright navigation error
    // (which names the URL and the phase) rather than as a SIGKILL with no
    // detail. Same reason run timeouts are layered elsewhere in this codebase.
    const navTimeoutMs = Math.max(5_000, timeoutMs - 5_000);

    const result = await runNodeHarness(
      buildHarness(
        playwrightEntry,
        url,
        snapshotPath,
        session?.path,
        options.waitForSelector,
        navTimeoutMs
      ),
      timeoutMs
    );

    if (!result.passed) {
      throw new Error(
        result.timedOut
          ? `Inspecting ${url} timed out after ${timeoutMs}ms.`
          : `Could not inspect ${url}: ${result.error ?? "unknown error"}`
      );
    }

    const raw = await fs.readFile(snapshotPath, "utf8");
    const snapshot = JSON.parse(raw) as PageSnapshot;
    snapshot.notes = [...notes, ...(snapshot.notes ?? [])];
    return snapshot;
  } finally {
    if (session) await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

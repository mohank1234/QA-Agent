import type { PageSnapshot, InspectedElement } from "./inspectPage";

// Self-healing, and its limits.
//
// A SCRIPT_ERROR means our locator was wrong, not that the application is
// broken. Often the element is right there on the page and we simply addressed
// it badly — an id that changed, a getByTestId() aimed at a `data-test`
// attribute, a role/name pair that no longer matches. In that case a fresh
// snapshot contains the correct way to reach the same element, and the fix is
// mechanical.
//
// What this deliberately does NOT do is guess. If the element the failing
// locator was aiming at cannot be found in the fresh snapshot, no heal is
// proposed — because an element that genuinely isn't on the page is a finding,
// possibly THE finding, and quietly swapping in a different element would
// manufacture a passing test that verifies nothing. Silently turning a red run
// green is a worse failure than leaving it red.
//
// Rewriting is string surgery on the script text, not model authorship: the
// replacement comes from the snapshot, so it is as real as the page.

export type HealPlan = {
  /** The locator expression that failed, as it appeared in the script. */
  originalLocator: string;
  /** Its replacement, taken from the fresh snapshot. */
  newLocator: string;
  /** The script with the substitution applied. */
  healedScript: string;
  /** Which element in the snapshot was matched, for the record. */
  matchedOn: string;
  /**
   * Other locators in the same script that were remapped in the same pass.
   *
   * A locator mistake is usually systematic rather than isolated — aiming
   * getByTestId() at a `data-test` attribute breaks every field in the script,
   * not just the first one Playwright happened to reach. Fixing only the
   * reported locator produces a retry that dies on the next line, which burns
   * the single permitted attempt to learn nothing. So one attempt repairs
   * everything it can confidently resolve; it is still one inspection and one
   * retry, with no loop.
   */
  additionalRewrites: { from: string; to: string }[];
};

/** What a failing locator was trying to address. */
type Target = {
  kind: "testId" | "domId" | "attrName" | "accessibleName" | "placeholder" | "role";
  value: string;
  /** For getByRole('button', { name: 'X' }) — the name part. */
  roleName?: string;
};

/**
 * Playwright names the locator it was waiting on inside the error. Two shapes
 * carry it, and both are matched here rather than assumed:
 *
 *   locator.click: Timeout 30000ms exceeded.
 *     - waiting for locator('#submit')
 *
 *   strict mode violation: getByRole('button') resolved to 3 elements
 */
export function extractFailingLocator(errorMessage: string | undefined): string | null {
  if (!errorMessage) return null;

  const waitingFor = errorMessage.match(/waiting for\s+(.+?)\s*(?:\n|$)/);
  if (waitingFor) {
    const candidate = waitingFor[1].trim();
    // "waiting for navigation" / "waiting for load state" name no locator.
    if (/^(locator|getBy\w+)\s*\(/.test(candidate)) return candidate;
  }

  const strictMode = errorMessage.match(
    /strict mode violation:\s*(locator\(.*?\)|getBy\w+\(.*?\))\s+resolved to/
  );
  if (strictMode) return strictMode[1].trim();

  return null;
}

function unquote(raw: string): string | null {
  const m = raw.match(/^\s*(['"`])([\s\S]*?)\1\s*$/);
  return m ? m[2] : null;
}

/**
 * Turns a locator expression into what it was actually trying to address, so
 * the same element can be looked up in a fresh snapshot regardless of how the
 * old script chose to reach it.
 */
export function describeTarget(locatorExpr: string): Target | null {
  const byTestId = locatorExpr.match(/^getByTestId\(\s*(.+?)\s*\)$/);
  if (byTestId) {
    const v = unquote(byTestId[1]);
    return v ? { kind: "testId", value: v } : null;
  }

  const byLabel = locatorExpr.match(/^getByLabel\(\s*(.+?)\s*\)$/);
  if (byLabel) {
    const v = unquote(byLabel[1]);
    return v ? { kind: "accessibleName", value: v } : null;
  }

  const byPlaceholder = locatorExpr.match(/^getByPlaceholder\(\s*(.+?)\s*\)$/);
  if (byPlaceholder) {
    const v = unquote(byPlaceholder[1]);
    return v ? { kind: "placeholder", value: v } : null;
  }

  const byText = locatorExpr.match(/^getByText\(\s*(.+?)\s*\)$/);
  if (byText) {
    const v = unquote(byText[1]);
    return v ? { kind: "accessibleName", value: v } : null;
  }

  const byRole = locatorExpr.match(/^getByRole\(\s*(['"`])(.+?)\1\s*(?:,\s*\{(.*)\}\s*)?\)$/);
  if (byRole) {
    const role = byRole[2];
    const nameMatch = byRole[3]?.match(/name\s*:\s*(['"`])(.*?)\1/);
    return { kind: "role", value: role, roleName: nameMatch?.[2] };
  }

  const css = locatorExpr.match(/^locator\(\s*(.+?)\s*\)$/);
  if (css) {
    const selector = unquote(css[1]);
    if (!selector) return null;

    const id = selector.match(/^#([\w-]+)$/);
    if (id) return { kind: "domId", value: id[1] };

    const attr = selector.match(/^\[([\w-]+)\s*=\s*(['"]?)(.*?)\2\]$/);
    if (attr) {
      const [, attrName, , attrValue] = attr;
      if (attrName === "name") return { kind: "attrName", value: attrValue };
      if (/^data-(testid|test-id|test|qa)$/.test(attrName)) {
        return { kind: "testId", value: attrValue };
      }
    }
    // A bare tag or class selector says too little to re-identify an element
    // confidently. Better no heal than the wrong element.
    return null;
  }

  return null;
}

const eq = (a: string | undefined, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Finds the element the failing locator was aiming at. Matching is by identity
 * across every field the snapshot carries — the whole premise is that the
 * element is still there under a different handle, so a testId lookup must also
 * be willing to match on id or name.
 */
export function findReplacement(
  target: Target,
  snapshot: PageSnapshot
): { element: InspectedElement; matchedOn: string } | null {
  const candidates = snapshot.elements.filter((el) => {
    if (target.kind === "role") {
      if (!eq(el.role, target.value)) return false;
      return target.roleName ? eq(el.name, target.roleName) : true;
    }
    return (
      eq(el.testId, target.value) ||
      eq(el.domId, target.value) ||
      eq(el.attrName, target.value) ||
      eq(el.name, target.value) ||
      eq(el.placeholder, target.value)
    );
  });

  if (candidates.length === 0) return null;

  // Prefer something a test can actually drive. If several remain equally
  // plausible the reference is ambiguous, and picking one arbitrarily is the
  // guessing this module refuses to do.
  const usable = candidates.filter((el) => el.visible && el.enabled);
  const pool = usable.length > 0 ? usable : candidates;
  if (pool.length > 1) return null;

  const element = pool[0];
  const matchedOn =
    target.kind === "role"
      ? `role "${target.value}"${target.roleName ? ` named "${target.roleName}"` : ""}`
      : `"${target.value}"`;
  return { element, matchedOn };
}

/**
 * Replaces the failing locator in the script text.
 *
 * The error reports the expression without its `page.` receiver while the
 * script usually writes it with one, and quote styles routinely differ between
 * the two — so both are tried rather than assuming a single spelling.
 */
function substitute(
  script: string,
  originalExpr: string,
  newLocator: string
): { script: string; replaced: string } | null {
  const bare = newLocator.replace(/^page\./, "");
  const swapQuotes = (s: string) =>
    s.includes("'") ? s.replace(/'/g, '"') : s.replace(/"/g, "'");

  const attempts: { find: string; put: string }[] = [
    { find: `page.${originalExpr}`, put: newLocator },
    { find: `page.${swapQuotes(originalExpr)}`, put: newLocator },
    { find: originalExpr, put: bare },
    { find: swapQuotes(originalExpr), put: bare },
  ];

  for (const { find, put } of attempts) {
    if (script.includes(find)) {
      return { script: script.split(find).join(put), replaced: find };
    }
  }
  return null;
}

/**
 * Produces a one-shot fix for a script whose locator didn't match, or null when
 * no confident fix exists. Null is a normal, frequent outcome and means the run
 * stands as it is.
 */
/** Every `page.getBy…()` / `page.locator(…)` expression written in the script. */
function locatorExpressionsIn(script: string): string[] {
  const found = script.match(/page\.(?:getBy\w+\([^)]*\)|locator\([^)]*\))/g) ?? [];
  return [...new Set(found.map((m) => m.replace(/^page\./, "")))];
}

/** Resolves one locator expression against the snapshot, or null if it can't. */
function remap(expr: string, snapshot: PageSnapshot): { to: string; matchedOn: string } | null {
  const target = describeTarget(expr);
  if (!target) return null;
  const match = findReplacement(target, snapshot);
  if (!match) return null;
  return { to: match.element.locator, matchedOn: match.matchedOn };
}

export function planHeal(
  script: string,
  errorMessage: string | undefined,
  snapshot: PageSnapshot
): HealPlan | null {
  const failing = extractFailingLocator(errorMessage);
  if (!failing) return null;

  // The reported locator must be fixable. If it isn't, the retry would fail in
  // exactly the same place, so repairing its neighbours accomplishes nothing.
  const primary = remap(failing, snapshot);
  if (!primary) return null;

  let working = script;
  const applied = substitute(working, failing, primary.to);
  if (!applied) return null;
  working = applied.script;

  const additionalRewrites: { from: string; to: string }[] = [];
  for (const expr of locatorExpressionsIn(script)) {
    if (expr === failing) continue;
    const mapped = remap(expr, snapshot);
    if (!mapped) continue;
    const next = substitute(working, expr, mapped.to);
    if (!next || next.script === working) continue;
    working = next.script;
    additionalRewrites.push({ from: next.replaced, to: mapped.to });
  }

  // The snapshot suggested exactly what already failed, and nothing else moved.
  // Retrying would burn the attempt to reach an identical result.
  if (working === script) return null;

  return {
    originalLocator: applied.replaced,
    newLocator: primary.to,
    healedScript: working,
    matchedOn: primary.matchedOn,
    additionalRewrites,
  };
}

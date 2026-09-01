import { describe, it, expect } from "vitest";
import { planHeal, extractFailingLocator, describeTarget, findReplacement } from "./selfHeal";
import type { PageSnapshot, InspectedElement } from "./inspectPage";

const el = (over: Partial<InspectedElement>): InspectedElement => ({
  role: "textbox",
  visible: true,
  enabled: true,
  locator: "page.getByTestId('x')",
  ...over,
});

const snapshotOf = (elements: InspectedElement[]): PageSnapshot => ({
  title: "Test",
  requestedUrl: "https://app.test/",
  finalUrl: "https://app.test/",
  redirected: false,
  headings: [],
  landmarks: [],
  forms: [],
  elements,
  totalInteractiveFound: elements.length,
  truncated: false,
  notes: [],
});

describe("extractFailingLocator", () => {
  it("pulls the locator out of a Playwright timeout", () => {
    const err =
      "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#submit')\n";
    expect(extractFailingLocator(err)).toBe("locator('#submit')");
  });

  it("pulls it out of a strict mode violation", () => {
    const err = "strict mode violation: getByRole('button') resolved to 3 elements";
    expect(extractFailingLocator(err)).toBe("getByRole('button')");
  });

  it("ignores waits that name no locator", () => {
    // "waiting for navigation" must not be parsed as a locator expression.
    expect(extractFailingLocator("Timeout exceeded.\n  - waiting for navigation")).toBeNull();
  });

  it("returns null for an unrelated error", () => {
    expect(extractFailingLocator("connect ECONNREFUSED")).toBeNull();
    expect(extractFailingLocator(undefined)).toBeNull();
  });
});

describe("describeTarget", () => {
  it.each([
    ["getByTestId('username')", "testId", "username"],
    ["locator('#user-name')", "domId", "user-name"],
    ['locator(\'[name="email"]\')', "attrName", "email"],
    ['locator(\'[data-test="login-button"]\')', "testId", "login-button"],
    ["getByLabel('Password')", "accessibleName", "Password"],
    ["getByPlaceholder('Search')", "placeholder", "Search"],
  ])("parses %s", (expr, kind, value) => {
    expect(describeTarget(expr)).toEqual({ kind, value });
  });

  it("parses a role with a name", () => {
    expect(describeTarget("getByRole('button', { name: 'Login' })")).toEqual({
      kind: "role",
      value: "button",
      roleName: "Login",
    });
  });

  it("refuses selectors too vague to re-identify an element", () => {
    // A class or bare tag could match anything on the next render. Healing from
    // one would be guessing, which is the thing this module must not do.
    expect(describeTarget("locator('.btn-primary')")).toBeNull();
    expect(describeTarget("locator('div')")).toBeNull();
  });
});

describe("findReplacement", () => {
  it("matches across identifier fields, not just the one that was used", () => {
    // The whole premise: the element is still there under a different handle.
    const snap = snapshotOf([
      el({ testId: "username", domId: "user-name", locator: "page.getByTestId('username')" }),
    ]);
    const found = findReplacement({ kind: "domId", value: "user-name" }, snap);
    expect(found?.element.testId).toBe("username");
  });

  it("prefers a visible, enabled element over a hidden one", () => {
    const snap = snapshotOf([
      el({ domId: "save", visible: false, locator: "page.locator('#save')" }),
      el({ domId: "save", visible: true, locator: "page.getByRole('button', { name: 'Save' })" }),
    ]);
    const found = findReplacement({ kind: "domId", value: "save" }, snap);
    expect(found?.element.locator).toContain("getByRole");
  });

  it("refuses to choose when the reference is ambiguous", () => {
    const snap = snapshotOf([
      el({ domId: "row", locator: "page.locator('#row').first()" }),
      el({ domId: "row", locator: "page.locator('#row').nth(1)" }),
    ]);
    expect(findReplacement({ kind: "domId", value: "row" }, snap)).toBeNull();
  });

  it("returns null when the element simply isn't there", () => {
    const snap = snapshotOf([el({ testId: "something-else" })]);
    expect(findReplacement({ kind: "testId", value: "username" }, snap)).toBeNull();
  });
});

describe("planHeal", () => {
  const snap = snapshotOf([
    el({
      testId: "username",
      testIdAttribute: "data-test",
      domId: "user-name",
      name: "Username",
      locator: 'page.locator(\'[data-test="username"]\')',
    }),
  ]);

  it("rewrites a getByTestId that was aimed at a data-test attribute", () => {
    // The exact real-world bug this feature exists for: getByTestId() binds to
    // data-testid only, so it silently matched nothing.
    const script = `await page.getByTestId('username').fill('bob');`;
    const err = "locator.fill: Timeout 30000ms exceeded.\n  - waiting for getByTestId('username')";

    const plan = planHeal(script, err, snap);
    expect(plan).not.toBeNull();
    expect(plan!.originalLocator).toBe("page.getByTestId('username')");
    expect(plan!.newLocator).toBe('page.locator(\'[data-test="username"]\')');
    expect(plan!.healedScript).toBe(
      `await page.locator('[data-test="username"]').fill('bob');`
    );
  });

  it("handles the script and the error using different quote styles", () => {
    const script = `await page.getByTestId("username").fill('bob');`;
    const err = "  - waiting for getByTestId('username')";
    const plan = planHeal(script, err, snap);
    expect(plan?.healedScript).toContain('page.locator(\'[data-test="username"]\')');
  });

  it("heals a stale id by matching the same element's other fields", () => {
    const script = `await page.locator('#user-name').fill('bob');`;
    const err = "  - waiting for locator('#user-name')";
    expect(planHeal(script, err, snap)?.newLocator).toBe(
      'page.locator(\'[data-test="username"]\')'
    );
  });

  it("refuses when the element is absent from the fresh snapshot", () => {
    // This is the important refusal: an element that isn't on the page may BE
    // the defect. Substituting a different one would fabricate a green run.
    const script = `await page.getByTestId('checkout-button').click();`;
    const err = "  - waiting for getByTestId('checkout-button')";
    expect(planHeal(script, err, snap)).toBeNull();
  });

  it("refuses when the snapshot suggests the locator that already failed", () => {
    const same = snapshotOf([
      el({ testId: "username", locator: "page.getByTestId('username')" }),
    ]);
    const script = `await page.getByTestId('username').fill('bob');`;
    const err = "  - waiting for getByTestId('username')";
    expect(planHeal(script, err, same)).toBeNull();
  });

  it("refuses when the failing locator isn't in the script text", () => {
    // The locator came from a helper or a variable, so there is nothing to
    // rewrite in place and a substitution would be blind.
    const script = `await loginWith(user);`;
    const err = "  - waiting for getByTestId('username')";
    expect(planHeal(script, err, snap)).toBeNull();
  });

  it("refuses when the error names no locator at all", () => {
    expect(planHeal(`await page.click('#x');`, "net::ERR_CONNECTION_REFUSED", snap)).toBeNull();
  });

  it("repairs every resolvable locator in one attempt, not just the reported one", () => {
    // A locator mistake is usually systematic. Fixing only the locator named in
    // the error produces a retry that dies on the next line — which spends the
    // one permitted attempt to learn nothing.
    const multi = snapshotOf([
      el({ testId: "username", locator: 'page.locator(\'[data-test="username"]\')' }),
      el({ testId: "password", locator: 'page.locator(\'[data-test="password"]\')' }),
      el({ testId: "login-button", role: "button", locator: 'page.locator(\'[data-test="login-button"]\')' }),
    ]);
    const script = [
      `await page.getByTestId('username').fill('u');`,
      `await page.getByTestId('password').fill('p');`,
      `await page.getByTestId('login-button').click();`,
    ].join("\n");
    const err = "  - waiting for getByTestId('username')";

    const plan = planHeal(script, err, multi);
    expect(plan).not.toBeNull();
    expect(plan!.additionalRewrites).toHaveLength(2);
    expect(plan!.healedScript).not.toContain("getByTestId");
    expect(plan!.healedScript).toContain('[data-test="password"]');
    expect(plan!.healedScript).toContain('[data-test="login-button"]');
  });

  it("still heals the reported locator when its neighbours can't be resolved", () => {
    const script = [
      `await page.getByTestId('username').fill('u');`,
      `await page.getByTestId('nonexistent').click();`,
    ].join("\n");
    const err = "  - waiting for getByTestId('username')";

    const plan = planHeal(script, err, snap);
    expect(plan?.additionalRewrites).toHaveLength(0);
    expect(plan?.healedScript).toContain('[data-test="username"]');
    // The unresolvable one is left exactly as written rather than guessed at.
    expect(plan?.healedScript).toContain("getByTestId('nonexistent')");
  });
});

import { describe, it, expect } from "vitest";
import { classifyOutcome, mayBecomeDefect, type RunDiagnostics } from "./classifyFailure";

const failing = (diagnostics?: RunDiagnostics, error?: string, timedOut = false) =>
  classifyOutcome({ passed: false, timedOut, error, diagnostics });

describe("classifyOutcome", () => {
  it("classifies a passing run as PASS regardless of what else was captured", () => {
    // A 5xx on some subresource does not retroactively fail a run that passed —
    // the assertions are the verdict, and inventing a failure from a side signal
    // would make green runs untrustworthy.
    const result = classifyOutcome({
      passed: true,
      timedOut: false,
      diagnostics: { serverErrors: [{ url: "https://app.test/api", status: 503, sameOrigin: true }] },
    });
    expect(result.classification).toBe("PASS");
  });

  describe("APP_ERROR — the application is at fault", () => {
    it("treats a page crash as APP_ERROR", () => {
      expect(failing({ crashed: true }).classification).toBe("APP_ERROR");
    });

    it("treats a 5xx on the document under test as APP_ERROR", () => {
      const r = failing({ mainStatus: 500, failureKind: "playwright" });
      expect(r.classification).toBe("APP_ERROR");
      expect(r.reason).toContain("500");
    });

    it("does NOT treat a 4xx on the document as APP_ERROR", () => {
      // A 404 is very often our own wrong URL, which is a script problem.
      // Only 5xx is evidence the server itself broke.
      expect(failing({ mainStatus: 404, failureKind: "playwright" }).classification).toBe(
        "SCRIPT_ERROR"
      );
    });

    it("treats an uncaught exception in page code as APP_ERROR", () => {
      const r = failing({ pageErrors: ["TypeError: cannot read properties of undefined"] });
      expect(r.classification).toBe("APP_ERROR");
      expect(r.reason).toContain("TypeError");
    });

    it("outranks an assertion failure when the page itself 5xx'd", () => {
      // The assertion never had a fair chance if the document was a 500.
      expect(failing({ mainStatus: 502, failureKind: "assertion" }).classification).toBe(
        "APP_ERROR"
      );
    });

    it("treats a same-origin subresource 5xx as APP_ERROR", () => {
      const r = failing({
        failureKind: "playwright",
        serverErrors: [{ url: "https://app.test/api/orders", status: 500, sameOrigin: true }],
      });
      expect(r.classification).toBe("APP_ERROR");
    });

    it("IGNORES a third-party 5xx — an analytics beacon is not a defect", () => {
      // This is the false positive the classifier exists to prevent: a broken
      // third-party call must not become a bug against the app under test.
      const r = failing(
        {
          failureKind: "playwright",
          errorName: "TimeoutError",
          serverErrors: [{ url: "https://analytics.vendor.io/collect", status: 503, sameOrigin: false }],
        },
        "locator.click: Timeout 30000ms exceeded."
      );
      expect(r.classification).toBe("SCRIPT_ERROR");
    });

    it("lets an assertion failure win over a mere subresource 5xx", () => {
      // The test still ran and reached its own conclusion, so the specific
      // "expected X, got Y" is the more precise finding.
      const r = failing({
        failureKind: "assertion",
        serverErrors: [{ url: "https://app.test/api/x", status: 500, sameOrigin: true }],
      });
      expect(r.classification).toBe("ASSERTION_FAIL");
    });
  });

  describe("ASSERTION_FAIL — the app behaved differently than specified", () => {
    it("classifies a tagged assertion failure as ASSERTION_FAIL", () => {
      const r = failing({ failureKind: "assertion" }, "expected total 100, got 90");
      expect(r.classification).toBe("ASSERTION_FAIL");
      expect(r.reason).toContain("expected total 100");
    });

    it("uses the tag, not the wording, so an assertion mentioning a locator still counts", () => {
      // The message contains "locator", which the string fallback would call a
      // SCRIPT_ERROR. The structured tag has to win, or a perfectly good finding
      // gets silently downgraded and never reported.
      const r = failing(
        { failureKind: "assertion" },
        "expected the locator for the cart badge to read 3, got 0"
      );
      expect(r.classification).toBe("ASSERTION_FAIL");
    });
  });

  describe("SCRIPT_ERROR — our test is at fault", () => {
    it("classifies a tagged Playwright failure as SCRIPT_ERROR", () => {
      const r = failing({ failureKind: "playwright", errorName: "TimeoutError" });
      expect(r.classification).toBe("SCRIPT_ERROR");
      expect(r.reason).toMatch(/locator never matched/);
    });

    it.each([
      ["locator.fill: Timeout 30000ms exceeded.\nwaiting for locator('#user')", "locator timeout"],
      ["strict mode violation: resolved to 3 elements", "ambiguous locator"],
      ["page.goto: net::ERR_NAME_NOT_RESOLVED at https://typo.example", "bad host"],
      ["SyntaxError: Unexpected token )", "broken script syntax"],
      ["TypeError: page.clik is not a function", "misspelled API call"],
    ])("falls back to the message when no diagnostics survived: %s", (message) => {
      expect(failing(undefined, message).classification).toBe("SCRIPT_ERROR");
    });

    it("classifies a timeout with no other signal as SCRIPT_ERROR", () => {
      const r = failing(undefined, "Script timed out after 60000ms and was killed.", true);
      expect(r.classification).toBe("SCRIPT_ERROR");
    });

    it("defaults an unattributable failure to SCRIPT_ERROR, never to a defect", () => {
      // The safety property: an outcome we cannot explain must not become an
      // accusation against the application.
      const r = failing(undefined, "something inexplicable happened");
      expect(r.classification).toBe("SCRIPT_ERROR");
      expect(mayBecomeDefect(r.classification)).toBe(false);
    });

    it("defaults to SCRIPT_ERROR even with no error message at all", () => {
      expect(failing().classification).toBe("SCRIPT_ERROR");
    });
  });
});

describe("mayBecomeDefect", () => {
  it("permits only real findings to become defects", () => {
    expect(mayBecomeDefect("ASSERTION_FAIL")).toBe(true);
    expect(mayBecomeDefect("APP_ERROR")).toBe(true);
  });

  it("refuses SCRIPT_ERROR and PASS", () => {
    // The entire point of the phase: a broken selector is not a defect.
    expect(mayBecomeDefect("SCRIPT_ERROR")).toBe(false);
    expect(mayBecomeDefect("PASS")).toBe(false);
  });
});

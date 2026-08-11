import { describe, it, expect } from "vitest";
import { needsBackgroundRun, type ExecutableTest } from "./executeTests";
import { MAX_INLINE_TIMEOUT_MS } from "./runAutomation";

function test(timeoutMs?: number): ExecutableTest {
  return { name: "t", testType: "browser", body: "", timeoutMs };
}

describe("needsBackgroundRun", () => {
  // Getting this wrong in the permissive direction is the expensive failure:
  // a long test awaited inside the chat request outlives it and the result is
  // lost, which is the exact problem the background model exists to prevent.
  it("detaches a run containing a test longer than the inline ceiling", () => {
    expect(needsBackgroundRun([test(MAX_INLINE_TIMEOUT_MS + 1)])).toBe(true);
    // A 15-minute idle-timeout test, the reference case.
    expect(needsBackgroundRun([test(16 * 60_000)])).toBe(true);
  });

  it("detaches when only one test in a suite is long", () => {
    expect(needsBackgroundRun([test(1000), test(30 * 60_000), test(1000)])).toBe(true);
  });

  it("runs inline when everything fits", () => {
    expect(needsBackgroundRun([test(1000), test(60_000)])).toBe(false);
    expect(needsBackgroundRun([test(MAX_INLINE_TIMEOUT_MS)])).toBe(false);
  });

  it("treats an unset timeout as short", () => {
    // No timeout means the runner's own default, which is well inside the
    // inline ceiling.
    expect(needsBackgroundRun([test(undefined)])).toBe(false);
  });

  it("does not detach an empty run", () => {
    expect(needsBackgroundRun([])).toBe(false);
  });
});

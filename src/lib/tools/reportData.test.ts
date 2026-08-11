import { describe, it, expect } from "vitest";
import { pct } from "./reportData";

describe("pct", () => {
  // The whole point of this helper. A report that says "0% pass rate" when
  // nothing has been executed is indistinguishable from one where every test
  // ran and failed — which is exactly the confusion the execution work exists
  // to remove.
  it("returns null, not zero, when there is nothing to measure", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, 0)).toBeNull();
  });

  it("returns a real zero when the denominator is real", () => {
    // Genuinely 0 of 4 passing IS 0% and must not be hidden.
    expect(pct(0, 4)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 2)).toBe(50);
    expect(pct(3, 3)).toBe(100);
  });
});

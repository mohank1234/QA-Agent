import { describe, it, expect } from "vitest";
import { judgeFixVerdict, inferEnvironment } from "./closeLoop";

// These cover the rules that stop the agent from claiming a defect is fixed
// when the evidence doesn't support it. They are the reason the logic was
// pulled out of the DB-bound verifyFix in the first place.

describe("judgeFixVerdict", () => {
  it("reports a fix only when the case actually failed before", () => {
    const v = judgeFixVerdict(true, 1, 0);
    expect(v.verdict).toBe("fixed");
    expect(v.proposedBugStatus).toBe("Ready for UAT");
  });

  it("never reports a fix for a case that has never failed", () => {
    // The important one: a green run on a test that always passed proves
    // nothing was repaired, however much someone wants it to.
    const v = judgeFixVerdict(true, 0, 5);
    expect(v.verdict).not.toBe("fixed");
    expect(v.verdict).toContain("nothing was verified as fixed");
    // The status proposal is what would actually move a defect towards
    // closure, so it must stay null here.
    expect(v.proposedBugStatus).toBeNull();
  });

  it("keeps a still-failing case open rather than proposing closure", () => {
    const v = judgeFixVerdict(false, 3, 0);
    expect(v.verdict).toBe("still failing");
    expect(v.proposedBugStatus).toBe("In Progress");
  });

  it("distinguishes a newly broken case from a persistent one", () => {
    const v = judgeFixVerdict(false, 0, 4);
    expect(v.verdict).toContain("newly failing");
    expect(v.proposedBugStatus).toBe("Open");
  });

  it("flags a case with both outcomes in history as flaky", () => {
    expect(judgeFixVerdict(true, 2, 3).flaky).toBe(true);
    expect(judgeFixVerdict(false, 2, 3).flaky).toBe(true);
  });

  it("does not call a case flaky when history is one-sided", () => {
    expect(judgeFixVerdict(true, 3, 0).flaky).toBe(false);
    expect(judgeFixVerdict(true, 0, 3).flaky).toBe(false);
    expect(judgeFixVerdict(true, 0, 0).flaky).toBe(false);
  });

  it("still marks a passing-but-flaky case as fixed, so the caller must weigh the flaky flag", () => {
    // Deliberate: the verdict describes the run, the flag describes the
    // history's reliability. Callers surface both rather than one silently
    // overriding the other.
    const v = judgeFixVerdict(true, 1, 1);
    expect(v.verdict).toBe("fixed");
    expect(v.flaky).toBe(true);
  });
});

describe("inferEnvironment", () => {
  it("recognises environments named in the host", () => {
    expect(inferEnvironment("https://uat.acme.com")).toBe("UAT");
    expect(inferEnvironment("https://staging.acme.com")).toBe("UAT");
    expect(inferEnvironment("https://sit.acme.com")).toBe("SIT");
    expect(inferEnvironment("https://qa.acme.com")).toBe("SIT");
    expect(inferEnvironment("https://dev.acme.com")).toBe("Dev");
    expect(inferEnvironment("http://localhost:3000")).toBe("Dev");
    expect(inferEnvironment("http://127.0.0.1:8080")).toBe("Dev");
    expect(inferEnvironment("https://www.acme.com")).toBe("Production");
  });

  it("returns undefined rather than guessing when the host says nothing", () => {
    // A bug that names an environment nobody established is worse than one
    // that leaves the field empty.
    expect(inferEnvironment("https://acme.io")).toBeUndefined();
    expect(inferEnvironment("https://app.acme.io")).toBeUndefined();
  });

  it("does not match an environment name embedded inside another word", () => {
    expect(inferEnvironment("https://development-notes.acme.com")).toBeUndefined();
    expect(inferEnvironment("https://quality.acme.com")).toBeUndefined();
  });

  it("returns undefined for input that is not a URL", () => {
    expect(inferEnvironment("not a url")).toBeUndefined();
    expect(inferEnvironment("")).toBeUndefined();
  });
});

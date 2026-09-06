import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  heuristicClassify,
  pickModel,
  nextTier,
  shouldEscalate,
  classifyComplexity,
} from "./modelRouter";

describe("heuristicClassify", () => {
  it("flags formal Test Plan/Test Strategy generation as complex", () => {
    expect(heuristicClassify("Please generate a full test plan for this BRD")).toBe("complex");
    expect(heuristicClassify("write me a test strategy document")).toBe("complex");
  });

  it("flags root-cause judgment as complex", () => {
    expect(heuristicClassify("what's the root cause of this failure?")).toBe("complex");
  });

  it("flags status/listing questions as simple", () => {
    expect(heuristicClassify("how many bugs are open")).toBe("simple");
    expect(heuristicClassify("list my test cases")).toBe("simple");
    expect(heuristicClassify("what is the current coverage")).toBe("simple");
  });

  it("defaults everything else to moderate", () => {
    expect(heuristicClassify("generate 5 test cases for the login form")).toBe("moderate");
    expect(heuristicClassify("draft a bug report for this crash")).toBe("moderate");
  });
});

describe("pickModel", () => {
  it("maps each complexity to the expected Claude tier", () => {
    expect(pickModel("simple")).toBe("claude-haiku-4-5");
    expect(pickModel("moderate")).toBe("claude-sonnet-5");
    expect(pickModel("complex")).toBe("claude-opus-5");
  });
});

describe("nextTier", () => {
  it("steps up exactly one tier at a time", () => {
    expect(nextTier("claude-haiku-4-5")).toBe("claude-sonnet-5");
    expect(nextTier("claude-sonnet-5")).toBe("claude-opus-5");
  });

  it("never escalates past claude-opus-5", () => {
    expect(nextTier("claude-opus-5")).toBeNull();
  });
});

describe("shouldEscalate", () => {
  it("escalates on error, failed document validation, or a near-empty reply", () => {
    expect(shouldEscalate({ isError: true, reply: "Full reply text here." })).toBe(true);
    expect(shouldEscalate({ isError: false, reply: "Full reply text here.", documentValidationFailed: true })).toBe(
      true
    );
    expect(shouldEscalate({ isError: false, reply: "ok" })).toBe(true);
  });

  it("does not escalate a normal successful reply", () => {
    expect(shouldEscalate({ isError: false, reply: "Here are the 5 open bugs you asked about." })).toBe(false);
  });
});

describe("classifyComplexity", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Simulates Ollama being unreachable (e.g. production, or not running
    // locally) so the fallback heuristic path is exercised deterministically
    // without depending on a real local Ollama server during test runs.
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("falls back to the heuristic when the local classifier is unreachable", async () => {
    expect(await classifyComplexity("how many bugs are open")).toBe("simple");
    expect(await classifyComplexity("generate a full test plan")).toBe("complex");
  });
});

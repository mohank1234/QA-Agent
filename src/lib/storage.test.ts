import { describe, it, expect, vi } from "vitest";

// storage.ts constructs an S3 client at module load from config, which would
// require real R2 credentials just to test two pure key functions.
vi.mock("./config", () => ({
  config: {
    r2: { accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucketName: "bucket" },
    isProduction: false,
  },
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

const { runEvidenceKey, sessionStateKey, evidenceUrlFromKey } = await import("./storage");

describe("runEvidenceKey", () => {
  it("namespaces by project, run, then execution", () => {
    expect(runEvidenceKey("p1", "r1", "e1", "screenshot.png")).toBe(
      "runs/p1/r1/e1/screenshot.png"
    );
  });

  it("strips directory components so a crafted name cannot escape the prefix", () => {
    // The path segments reach this from tool arguments and URLs, so traversal
    // must not be able to land an object outside the project's own prefix.
    expect(runEvidenceKey("p1", "r1", "e1", "../../../secrets.env")).toBe(
      "runs/p1/r1/e1/secrets.env"
    );
    expect(runEvidenceKey("p1", "../other", "e1", "a.png")).toBe("runs/p1/other/e1/a.png");
  });
});

describe("sessionStateKey", () => {
  it("stores sessions outside the runs prefix so they outlive a run's evidence", () => {
    const key = sessionStateKey("p1", "standard-user");
    expect(key).toBe("sessions/p1/standard-user.json");
    expect(key.startsWith("runs/")).toBe(false);
  });

  it("keeps sessions under the project prefix so they die with the project", () => {
    expect(sessionStateKey("p1", "x")).toContain("/p1/");
  });
});

describe("evidenceUrlFromKey", () => {
  it("maps a stored key to the route that serves it", () => {
    expect(evidenceUrlFromKey("runs/p1/r1/e1/screenshot.png")).toBe(
      "/api/evidence/p1/r1/e1/screenshot.png"
    );
  });

  it("round-trips with runEvidenceKey", () => {
    const key = runEvidenceKey("proj", "run", "exec", "trace.zip");
    expect(evidenceUrlFromKey(key)).toBe("/api/evidence/proj/run/exec/trace.zip");
  });

  it("returns null for anything that is not an evidence key", () => {
    // Prevents an unrelated key (an upload, an export) from being handed out
    // as an evidence URL.
    expect(evidenceUrlFromKey("uploads/p1/doc.pdf")).toBeNull();
    expect(evidenceUrlFromKey("runs/p1/r1/screenshot.png")).toBeNull();
    expect(evidenceUrlFromKey("")).toBeNull();
  });
});

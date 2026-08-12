import { describe, it, expect } from "vitest";
import { buildDocumentFileName } from "./documentNaming";

const AUG_11 = new Date(2026, 7, 11);

describe("buildDocumentFileName", () => {
  it("produces a business-presentable name", () => {
    const { fileName } = buildDocumentFileName("SmartLeave Test Plan", "test_plan", [], AUG_11);
    expect(fileName).toBe("SmartLeave_Test_Plan_v1.0_2026-08-11.docx");
  });

  it("does not repeat the document type already in the title", () => {
    // "SmartLeave Test Plan" + test_plan must not become
    // "SmartLeave_Test_Plan_Test_Plan".
    const { fileName } = buildDocumentFileName("SmartLeave Test Plan", "test_plan", [], AUG_11);
    expect(fileName.match(/Test_Plan/g)).toHaveLength(1);
  });

  it("appends the type when the title omits it", () => {
    const { fileName } = buildDocumentFileName("SmartLeave", "test_strategy", [], AUG_11);
    expect(fileName).toBe("SmartLeave_Test_Strategy_v1.0_2026-08-11.docx");
  });

  it("preserves deliberate casing instead of title-casing over it", () => {
    // A blanket toLowerCase turned "SmartLeave" into "smartleave", which is
    // what made the old names look machine-generated.
    expect(buildDocumentFileName("SmartLeave API Test Plan", "test_plan", [], AUG_11).fileName).toBe(
      "SmartLeave_API_Test_Plan_v1.0_2026-08-11.docx"
    );
  });

  it("capitalises lowercase input", () => {
    expect(buildDocumentFileName("payments api", "test_plan", [], AUG_11).fileName).toBe(
      "Payments_Api_Test_Plan_v1.0_2026-08-11.docx"
    );
  });

  it("increments the version for a regenerated document", () => {
    const existing = ["SmartLeave_Test_Plan_v1.0_2026-08-11.docx"];
    const { fileName, version } = buildDocumentFileName(
      "SmartLeave Test Plan",
      "test_plan",
      existing,
      AUG_11
    );
    expect(version).toBe(2);
    expect(fileName).toBe("SmartLeave_Test_Plan_v2.0_2026-08-11.docx");
  });

  it("continues from the highest existing version, not the count", () => {
    const existing = [
      "SmartLeave_Test_Plan_v1.0_2026-08-01.docx",
      "SmartLeave_Test_Plan_v3.0_2026-08-05.docx",
    ];
    expect(
      buildDocumentFileName("SmartLeave Test Plan", "test_plan", existing, AUG_11).version
    ).toBe(4);
  });

  it("versions each document type independently", () => {
    const existing = ["SmartLeave_Test_Plan_v2.0_2026-08-11.docx"];
    const { fileName } = buildDocumentFileName(
      "SmartLeave Test Strategy",
      "test_strategy",
      existing,
      AUG_11
    );
    expect(fileName).toBe("SmartLeave_Test_Strategy_v1.0_2026-08-11.docx");
  });

  it("strips punctuation and filler words", () => {
    const { fileName } = buildDocumentFileName(
      "SmartLeave: Test Plan & Strategy for the Release",
      "test_plan",
      [],
      AUG_11
    );
    expect(fileName).toMatch(/^[A-Za-z0-9_.-]+\.docx$/);
    expect(fileName).not.toContain("&");
    expect(fileName).not.toContain(":");
  });

  it("keeps a sentence-length title to a usable length", () => {
    const { fileName } = buildDocumentFileName(
      "Comprehensive end to end quality assurance verification approach document",
      "test_plan",
      [],
      AUG_11
    );
    expect(fileName.length).toBeLessThan(90);
  });

  it("still names a document with an empty title", () => {
    const { fileName } = buildDocumentFileName("", "defect_summary_report", [], AUG_11);
    expect(fileName).toBe("Defect_Summary_Report_v1.0_2026-08-11.docx");
  });

  it("produces names that are safe as URL path segments and object keys", () => {
    const { fileName } = buildDocumentFileName("../../etc/passwd Test Plan", "test_plan", [], AUG_11);
    expect(fileName).not.toContain("/");
    expect(fileName).not.toContain("..");
  });
});

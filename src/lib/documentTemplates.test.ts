import { describe, it, expect } from "vitest";
import {
  checkAgainstTemplate,
  TEST_PLAN_TEMPLATE,
  TEST_STRATEGY_TEMPLATE,
} from "./documentTemplates";

function docWith(sections: string[]): string {
  return sections.map((s) => `## ${s}\n\nSome content.\n`).join("\n");
}

describe("checkAgainstTemplate", () => {
  it("accepts a complete Test Plan", () => {
    const result = checkAgainstTemplate("test_plan", docWith(TEST_PLAN_TEMPLATE.sections));
    expect(result?.ok).toBe(true);
    expect(result?.missing).toEqual([]);
  });

  it("accepts a complete Test Strategy", () => {
    const result = checkAgainstTemplate("test_strategy", docWith(TEST_STRATEGY_TEMPLATE.sections));
    expect(result?.ok).toBe(true);
  });

  it("names exactly which sections are missing", () => {
    // The whole point of rejecting: the agent has to be told what to add,
    // otherwise it regenerates something equally incomplete.
    const partial = TEST_PLAN_TEMPLATE.sections.filter(
      (s) => s !== "Approvals" && s !== "Suspension Criteria and Resumption Requirements"
    );
    const result = checkAgainstTemplate("test_plan", docWith(partial));
    expect(result?.ok).toBe(false);
    expect(result?.missing).toEqual([
      "Suspension Criteria and Resumption Requirements",
      "Approvals",
    ]);
  });

  it("tolerates numbering, case and punctuation differences", () => {
    // Writers number their headings; rejecting "4. Test Items" for having a
    // number would make the check useless in practice.
    const styled = TEST_PLAN_TEMPLATE.sections.map((s, i) => `${i + 1}. ${s.toUpperCase()}`);
    const result = checkAgainstTemplate("test_plan", docWith(styled));
    expect(result?.ok).toBe(true);
  });

  it("accepts required sections at any heading level", () => {
    const doc = TEST_PLAN_TEMPLATE.sections.map((s) => `### ${s}\n\ntext\n`).join("\n");
    expect(checkAgainstTemplate("test_plan", doc)?.ok).toBe(true);
  });

  it("reports sections that appear out of the template's order", () => {
    const reordered = [...TEST_PLAN_TEMPLATE.sections];
    const [approvals] = reordered.splice(reordered.indexOf("Approvals"), 1);
    reordered.unshift(approvals);
    const result = checkAgainstTemplate("test_plan", docWith(reordered));
    expect(result?.ok).toBe(true); // present, so not a rejection
    expect(result?.outOfOrder.length).toBeGreaterThan(0);
  });

  it("does not constrain document types that have no fixed template", () => {
    // Reports and ad-hoc documents must stay free-form.
    expect(checkAgainstTemplate("daily_status_report", "# Anything")).toBeNull();
    expect(checkAgainstTemplate("other", "")).toBeNull();
  });

  it("rejects an empty document rather than passing it through", () => {
    expect(checkAgainstTemplate("test_plan", "")?.ok).toBe(false);
  });

  it("keeps Test Plan and Test Strategy structurally distinct", () => {
    // If a merged document could satisfy both, the split would be cosmetic.
    const planDoc = docWith(TEST_PLAN_TEMPLATE.sections);
    expect(checkAgainstTemplate("test_strategy", planDoc)?.ok).toBe(false);

    const strategyDoc = docWith(TEST_STRATEGY_TEMPLATE.sections);
    expect(checkAgainstTemplate("test_plan", strategyDoc)?.ok).toBe(false);
  });
});

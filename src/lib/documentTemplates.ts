// Required section structures for the formal QA deliverables.
//
// These exist because "the content was fine but the format wasn't" is a real
// failure for a document someone has to sign off. A Test Plan that omits
// Suspension Criteria or Approvals is not a Test Plan a QA lead can hand to an
// auditor, however good its prose.
//
// Sources the structures are drawn from:
//   Test Plan     — IEEE 829-1998 clause list (the structure most teams still
//                   sign against), aligned with ISO/IEC/IEEE 29119-3:2021,
//                   which supersedes it.
//   Test Strategy — ISTQB's definition of a strategy as the *organisational*
//                   approach that forms an input to the plan, plus the
//                   commonly used industry template (scope, approach,
//                   environment, tooling, release control, risk, approvals).
//
// The two are deliberately separate documents: a strategy is written once for
// a programme and changes rarely; a plan is written per release and cites the
// strategy. Merging them produces a document that is wrong at both levels.

export type TemplatedDocType = "test_plan" | "test_strategy";

export type DocumentTemplate = {
  title: string;
  summary: string;
  /** Headings that must appear, in this order, as level-2 markdown headings. */
  sections: string[];
  /** Pages a complete document of this kind usually runs to. */
  lengthGuide: string;
};

export const TEST_PLAN_TEMPLATE: DocumentTemplate = {
  title: "Test Plan",
  summary:
    "Release- or project-level. What will be tested, by whom, when, under which conditions, and what makes it pass or stop.",
  lengthGuide: "4–8 pages",
  sections: [
    "Test Plan Identifier",
    "References",
    "Introduction",
    "Test Items",
    "Software Risk Issues",
    "Features to be Tested",
    "Features not to be Tested",
    "Approach",
    "Item Pass/Fail Criteria",
    "Suspension Criteria and Resumption Requirements",
    "Test Deliverables",
    "Remaining Test Tasks",
    "Environmental Needs",
    "Staffing and Training Needs",
    "Responsibilities",
    "Schedule",
    "Planning Risks and Contingencies",
    "Approvals",
    "Glossary",
  ],
};

export const TEST_STRATEGY_TEMPLATE: DocumentTemplate = {
  title: "Test Strategy",
  summary:
    "Organisation- or programme-level. The standing approach to testing that individual test plans inherit from and cite.",
  lengthGuide: "3–6 pages",
  sections: [
    "Document Control",
    "Scope and Overview",
    "Testing Objectives",
    "Test Approach",
    "Test Levels",
    "Test Types",
    "Entry and Exit Criteria",
    "Test Environment",
    "Test Data Management",
    "Testing Tools",
    "Defect Management Process",
    "Release Control",
    "Risk Analysis and Mitigation",
    "Roles and Responsibilities",
    "Metrics and Reporting",
    "Review and Approvals",
  ],
};

export const DOCUMENT_TEMPLATES: Record<TemplatedDocType, DocumentTemplate> = {
  test_plan: TEST_PLAN_TEMPLATE,
  test_strategy: TEST_STRATEGY_TEMPLATE,
};

export function isTemplatedDocType(docType: string): docType is TemplatedDocType {
  return docType === "test_plan" || docType === "test_strategy";
}

// Matches a markdown heading line and returns its text, whatever the level.
function headingsIn(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => /^#{1,6}\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((h): h is string => !!h);
}

// Loose comparison: numbering ("4. Test Items"), punctuation and case vary
// between writers, and rejecting a correct section over a "/" would be worse
// than useless. Only the words are compared.
function normalize(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^\d+(\.\d+)*[).]?\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type TemplateCheck = {
  ok: boolean;
  missing: string[];
  /** Sections present but out of the template's order. */
  outOfOrder: string[];
};

/**
 * Checks a document body against its template. Used to reject a malformed
 * deliverable at save time rather than discovering it when someone opens the
 * .docx — the agent gets told exactly which headings are missing and can fix
 * them, which a prompt instruction alone does not reliably achieve.
 */
export function checkAgainstTemplate(docType: string, markdown: string): TemplateCheck | null {
  if (!isTemplatedDocType(docType)) return null;

  const template = DOCUMENT_TEMPLATES[docType];
  const present = headingsIn(markdown).map(normalize);

  const missing = template.sections.filter(
    (section) => !present.some((h) => h === normalize(section))
  );

  // Order is checked only across the sections that are actually present, so a
  // missing section isn't also reported as an ordering fault.
  const indexes = template.sections
    .map((section) => ({ section, at: present.indexOf(normalize(section)) }))
    .filter((x) => x.at >= 0);
  const outOfOrder: string[] = [];
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i].at < indexes[i - 1].at) outOfOrder.push(indexes[i].section);
  }

  return { ok: missing.length === 0, missing, outOfOrder };
}

/** The template rendered as instructions, for the tool description/prompt. */
export function templateOutline(docType: TemplatedDocType): string {
  const t = DOCUMENT_TEMPLATES[docType];
  return `${t.title} (${t.lengthGuide}) — ${t.summary}\nRequired sections, in order, as '## ' headings:\n${t.sections
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")}`;
}

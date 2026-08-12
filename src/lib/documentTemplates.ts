// Formal QA deliverable templates.
//
// Two things are enforced here, because "the content was fine but the format
// wasn't" is a real failure for a document someone has to sign off:
//
//   1. A Test Plan and a Test Strategy are separate deliverables. A strategy
//      is programme-wide and long-lived; a plan is per release and cites the
//      strategy. ISTQB treats the strategy as an input to the plan, so a
//      merged file is wrong at both levels.
//   2. Each has a required section structure, validated at save time.
//
// Several variants exist per type because a regulated banking programme and a
// two-week sprint do not sign off the same document. The user picks the format
// up front; the picked format is what the document is validated against.

export type TemplatedDocType = "test_plan" | "test_strategy";

export type TemplateTheme = {
  /** Hex without '#', used for headings, rules and table header fill. */
  accent: string;
  /** Light tint of the accent, for banded table rows. */
  tint: string;
};

export const THEMES: Record<string, TemplateTheme> = {
  indigo: { accent: "4F46E5", tint: "EEF0FD" },
  slate: { accent: "334155", tint: "EEF2F6" },
  teal: { accent: "0F766E", tint: "E6F4F2" },
  amber: { accent: "B45309", tint: "FDF3E4" },
};

export type DocumentTemplate = {
  id: string;
  docType: TemplatedDocType;
  /** Shown in the picker. */
  name: string;
  /** One line on what this format is and when it fits. */
  description: string;
  /** Where the structure comes from, so the choice is defensible. */
  basis: string;
  bestFor: string;
  lengthGuide: string;
  theme: TemplateTheme;
  /** Required headings, in order. */
  sections: string[];
};

// --- Test Plan variants --------------------------------------------------

const IEEE_829_PLAN: DocumentTemplate = {
  id: "ieee-829",
  docType: "test_plan",
  name: "IEEE 829 Standard Test Plan",
  description:
    "The classic 19-clause plan. Exhaustive and audit-friendly — the structure most organisations formally sign against.",
  basis: "IEEE 829-1998 test plan clause list",
  bestFor: "Regulated, audited or client-contracted delivery",
  lengthGuide: "6–10 pages",
  theme: THEMES.indigo,
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

const ISO_29119_PLAN: DocumentTemplate = {
  id: "iso-29119",
  docType: "test_plan",
  name: "ISO/IEC/IEEE 29119-3 Test Plan",
  description:
    "The current international standard. Leaner than IEEE 829 and organised around risk and strategy rather than clause count.",
  basis: "ISO/IEC/IEEE 29119-3:2021 test plan information item",
  bestFor: "Modern standards-aligned programmes",
  lengthGuide: "5–8 pages",
  theme: THEMES.slate,
  sections: [
    "Document Control",
    "Introduction",
    "Context of Testing",
    "Test Scope",
    "Testing Communication",
    "Risk Register",
    "Test Strategy Reference",
    "Test Approach",
    "Entry and Exit Criteria",
    "Test Deliverables",
    "Test Environment and Data",
    "Staffing and Roles",
    "Schedule and Milestones",
    "Metrics and Reporting",
    "Approvals",
  ],
};

const AGILE_PLAN: DocumentTemplate = {
  id: "agile-sprint",
  docType: "test_plan",
  name: "Agile / Sprint Test Plan",
  description:
    "Lightweight, one-iteration plan. Covers what's being tested this sprint and the definition of done, without ceremony.",
  basis: "Common Agile test planning practice (ISTQB Agile Tester)",
  bestFor: "Sprint or release-train delivery",
  lengthGuide: "2–4 pages",
  theme: THEMES.teal,
  sections: [
    "Sprint / Release Overview",
    "Objectives",
    "Scope — In and Out",
    "User Stories and Acceptance Criteria",
    "Test Approach",
    "Definition of Done",
    "Automation and Regression",
    "Environment and Test Data",
    "Risks and Dependencies",
    "Roles and Responsibilities",
    "Reporting and Metrics",
    "Sign-off",
  ],
};

const ENTERPRISE_PLAN: DocumentTemplate = {
  id: "enterprise-uat",
  docType: "test_plan",
  name: "Enterprise / UAT Delivery Test Plan",
  description:
    "Client-facing delivery plan with governance built in — RACI, defect SLAs, entry/exit gates and formal acceptance.",
  basis: "Common enterprise SI/consultancy delivery template",
  bestFor: "UAT, vendor delivery and client acceptance",
  lengthGuide: "6–10 pages",
  theme: THEMES.amber,
  sections: [
    "Document Control",
    "Executive Summary",
    "Purpose and Objectives",
    "Scope of Testing",
    "Out of Scope",
    "Test Phases and Levels",
    "Entry Criteria",
    "Exit Criteria",
    "Suspension and Resumption Criteria",
    "Test Environment",
    "Test Data Requirements",
    "Roles and Responsibilities (RACI)",
    "Defect Management and SLA",
    "Risk Assessment and Mitigation",
    "Schedule and Milestones",
    "Test Deliverables",
    "Communication Plan",
    "Acceptance and Sign-off",
  ],
};

// --- Test Strategy variants ----------------------------------------------

const ISTQB_STRATEGY: DocumentTemplate = {
  id: "istqb-standard",
  docType: "test_strategy",
  name: "Standard QA Test Strategy",
  description:
    "The conventional organisation-level strategy: levels, types, tooling, defect process and governance.",
  basis: "ISTQB Foundation test strategy definition + common industry template",
  bestFor: "A standing strategy that individual plans inherit",
  lengthGuide: "4–7 pages",
  theme: THEMES.indigo,
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

const RISK_BASED_STRATEGY: DocumentTemplate = {
  id: "risk-based",
  docType: "test_strategy",
  name: "Risk-Based Test Strategy",
  description:
    "Organises everything around product risk — what could fail, how badly, and how much testing each risk earns.",
  basis: "Risk-based testing practice (ISTQB Advanced Test Manager)",
  bestFor: "Limited time or budget, where coverage must be justified",
  lengthGuide: "4–6 pages",
  theme: THEMES.amber,
  sections: [
    "Document Control",
    "Purpose and Scope",
    "Quality Risk Analysis",
    "Risk Assessment Matrix",
    "Risk-Based Prioritisation",
    "Test Approach by Risk Level",
    "Test Levels and Types",
    "Coverage Targets",
    "Entry and Exit Criteria",
    "Environment and Test Data",
    "Defect Management",
    "Residual Risk Reporting",
    "Roles and Responsibilities",
    "Review and Approvals",
  ],
};

const AGILE_STRATEGY: DocumentTemplate = {
  id: "agile-qa",
  docType: "test_strategy",
  name: "Agile QA Strategy",
  description:
    "Shift-left strategy built around the test pyramid, CI/CD gates and whole-team quality ownership.",
  basis: "Agile testing quadrants and test automation pyramid",
  bestFor: "Continuous delivery teams",
  lengthGuide: "3–6 pages",
  theme: THEMES.teal,
  sections: [
    "Document Control",
    "Purpose and Principles",
    "Quality Ownership Model",
    "Test Automation Pyramid",
    "Shift-Left Practices",
    "Continuous Integration and Test Gates",
    "Test Levels and Types",
    "Exploratory Testing",
    "Environment and Test Data",
    "Definition of Done",
    "Defect Management",
    "Metrics and Feedback Loops",
    "Roles and Responsibilities",
    "Review and Approvals",
  ],
};

export const TEMPLATES: DocumentTemplate[] = [
  IEEE_829_PLAN,
  ISO_29119_PLAN,
  AGILE_PLAN,
  ENTERPRISE_PLAN,
  ISTQB_STRATEGY,
  RISK_BASED_STRATEGY,
  AGILE_STRATEGY,
];

// Used when the caller doesn't name a format. Kept as the most formal option
// of each type, since an over-complete document is easier to trim than an
// under-complete one is to defend.
export const DEFAULT_TEMPLATE_ID: Record<TemplatedDocType, string> = {
  test_plan: IEEE_829_PLAN.id,
  test_strategy: ISTQB_STRATEGY.id,
};

export function templatesFor(docType: TemplatedDocType): DocumentTemplate[] {
  return TEMPLATES.filter((t) => t.docType === docType);
}

export function getTemplate(
  docType: string,
  templateId?: string
): DocumentTemplate | null {
  if (!isTemplatedDocType(docType)) return null;
  const id = templateId ?? DEFAULT_TEMPLATE_ID[docType];
  return TEMPLATES.find((t) => t.docType === docType && t.id === id) ?? null;
}

export function isTemplatedDocType(docType: string): docType is TemplatedDocType {
  return docType === "test_plan" || docType === "test_strategy";
}

// --- Validation -----------------------------------------------------------

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
  templateId: string;
  templateName: string;
  missing: string[];
  /** Sections present but out of the template's order. */
  outOfOrder: string[];
};

/**
 * Checks a document body against the chosen template. Rejecting at save time
 * is what actually produces complete documents — a prompt instruction alone
 * does not, and the failure would otherwise only surface when someone opens
 * the .docx to sign it.
 */
export function checkAgainstTemplate(
  docType: string,
  markdown: string,
  templateId?: string
): TemplateCheck | null {
  const template = getTemplate(docType, templateId);
  if (!template) return null;

  const present = headingsIn(markdown).map(normalize);

  const missing = template.sections.filter(
    (section) => !present.some((h) => h === normalize(section))
  );

  const indexes = template.sections
    .map((section) => ({ section, at: present.indexOf(normalize(section)) }))
    .filter((x) => x.at >= 0);
  const outOfOrder: string[] = [];
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i].at < indexes[i - 1].at) outOfOrder.push(indexes[i].section);
  }

  return {
    ok: missing.length === 0,
    templateId: template.id,
    templateName: template.name,
    missing,
    outOfOrder,
  };
}

/** The template rendered as instructions, for the tool description/prompt. */
export function templateOutline(template: DocumentTemplate): string {
  return `${template.name} (id: "${template.id}", ${template.lengthGuide}) — ${template.description}\nRequired sections, in order, as '## ' headings:\n${template.sections
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n")}`;
}

export function allTemplateOutlines(): string {
  return TEMPLATES.map(templateOutline).join("\n\n");
}

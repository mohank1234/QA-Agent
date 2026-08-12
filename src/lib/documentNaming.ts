// File names for generated deliverables.
//
// These files get attached to emails, uploaded to SharePoint, and put in front
// of clients, so the name is part of the deliverable. The previous format —
// "2026-07-29T06-37-04-778Z_smartleave_test_plan_test_strategy.docx" — led
// with a machine timestamp down to the millisecond, lowercased the product
// name, and carried no version, which is the first thing anyone looks for on a
// document that gets revised.
//
// Convention used here, which is the common corporate one:
//
//     SmartLeave_Test_Plan_v1.0_2026-08-11.docx
//     <Subject>_<Document Type>_v<major>.0_<YYYY-MM-DD>.docx
//
// Subject first so files sort by product, then type; version before date so a
// revision is obvious at a glance.

const DOC_TYPE_LABELS: Record<string, string> = {
  test_plan: "Test Plan",
  test_strategy: "Test Strategy",
  test_summary_report: "Test Summary Report",
  defect_summary_report: "Defect Summary Report",
  release_readiness_report: "Release Readiness Report",
  daily_status_report: "Daily QA Status Report",
  requirement_coverage_report: "Requirement Coverage Report",
  other: "Document",
};

// Capitalises a word without destroying casing the author chose deliberately —
// "SmartLeave" and "API" must survive, which a blanket toLowerCase would ruin.
function titleCaseWord(word: string): string {
  if (/[A-Z]/.test(word.slice(1))) return word; // SmartLeave, API, OAuth
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function toWords(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Strips the document-type words from a title so the type isn't repeated.
 * "SmartLeave Test Plan" + test_plan should give subject "SmartLeave", not
 * "SmartLeave Test Plan Test Plan".
 */
function subjectFrom(title: string, typeLabel: string): string[] {
  const words = toWords(title);
  const typeWords = toWords(typeLabel).map(normalizeForCompare);

  // Drop a trailing or leading run matching the type label.
  const normalized = words.map(normalizeForCompare);
  for (let start = 0; start <= normalized.length - typeWords.length; start++) {
    const window = normalized.slice(start, start + typeWords.length);
    if (window.every((w, i) => w === typeWords[i])) {
      return [...words.slice(0, start), ...words.slice(start + typeWords.length)];
    }
  }
  return words;
}

// Filler that adds nothing to a file name once the type is already in it.
const NOISE = new Set(["and", "the", "for", "a", "an", "of", "&"]);

export type DocumentNameParts = {
  fileName: string;
  /** Base without version/date, used to detect revisions of the same document. */
  base: string;
  version: number;
};

/**
 * Builds the file name for a generated document.
 *
 * `existingFileNames` are the project's current documents; a new document
 * whose base matches an existing one is treated as a revision and gets the
 * next version rather than silently overwriting or colliding.
 */
export function buildDocumentFileName(
  title: string,
  docType: string,
  existingFileNames: string[] = [],
  now: Date = new Date()
): DocumentNameParts {
  const typeLabel = DOC_TYPE_LABELS[docType] ?? DOC_TYPE_LABELS.other;

  const subjectWords = subjectFrom(title, typeLabel)
    .filter((w) => !NOISE.has(w.toLowerCase()))
    .map(titleCaseWord)
    // Keeps names sane when a title is a whole sentence.
    .slice(0, 6);

  const typeWords = toWords(typeLabel).map(titleCaseWord);
  const base = [...subjectWords, ...typeWords].join("_");

  // Next version = one more than the highest already used for this base.
  const versionPattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_v(\\d+)\\.`, "i");
  const highest = existingFileNames.reduce((max, name) => {
    const match = versionPattern.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const version = highest + 1;

  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  return { fileName: `${base}_v${version}.0_${date}.docx`, base, version };
}

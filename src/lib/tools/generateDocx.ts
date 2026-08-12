import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { THEMES, type TemplateTheme } from "../documentTemplates";

// Word rendering for the generated deliverables.
//
// The previous version emitted default Word styles: black Calibri headings, a
// grey table header, no cover, no page numbers. Correct content in a shape
// nobody would put in front of a client. This produces a document that looks
// prepared rather than dumped — themed headings with rules, banded tables, a
// cover page and a document-control block, and a footer that pages properly.

const DEFAULT_THEME = THEMES.indigo;
const INK = "1A1A1E";
const MUTED = "6B6B78";
const HAIRLINE = "D9D9E0";

export type DocxMeta = {
  /** e.g. "Test Plan" — shown under the title on the cover. */
  documentType?: string;
  /** e.g. "IEEE 829 Standard Test Plan". */
  templateName?: string;
  projectName?: string;
  version?: string;
  theme?: TemplateTheme;
};

function parseInlineBold(line: string, opts: { color?: string; size?: number } = {}): TextRun[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  const base = { color: opts.color ?? INK, size: opts.size ?? 21 }; // half-points: 21 = 10.5pt
  if (parts.length === 0) return [new TextRun({ text: "", ...base })];
  return parts.map((part) =>
    part.startsWith("**") && part.endsWith("**")
      ? new TextRun({ text: part.slice(2, -2), bold: true, ...base })
      : new TextRun({ text: part, ...base })
  );
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\s*$/.test(line) && line.includes("-");
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
} as const;

function hairline(color = HAIRLINE) {
  return {
    top: { style: BorderStyle.SINGLE, size: 2, color },
    bottom: { style: BorderStyle.SINGLE, size: 2, color },
    left: { style: BorderStyle.SINGLE, size: 2, color },
    right: { style: BorderStyle.SINGLE, size: 2, color },
  };
}

/**
 * Data tables: accent-filled header with white bold text, alternating row
 * bands, hairline borders. Banding is what makes a wide QA table (risk
 * matrices, RACI, severity definitions) readable across a row.
 */
function buildTable(rows: string[][], theme: TemplateTheme): Table {
  const colCount = Math.max(...rows.map((r) => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: hairline(),
    rows: rows.map((cells, rowIndex) => {
      const isHeader = rowIndex === 0;
      const banded = !isHeader && rowIndex % 2 === 0;
      return new TableRow({
        tableHeader: isHeader,
        children: Array.from({ length: colCount }, (_, i) => {
          const cellText = cells[i] ?? "";
          return new TableCell({
            margins: { top: 90, bottom: 90, left: 120, right: 120 },
            shading: isHeader
              ? { type: ShadingType.CLEAR, fill: theme.accent, color: "auto" }
              : banded
                ? { type: ShadingType.CLEAR, fill: theme.tint, color: "auto" }
                : undefined,
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: isHeader
                  ? [new TextRun({ text: cellText, bold: true, color: "FFFFFF", size: 19 })]
                  : parseInlineBold(cellText, { size: 19 }),
              }),
            ],
          });
        }),
      });
    }),
  });
}

/** Two-column key/value block used for Document Control on the cover. */
function metaTable(pairs: [string, string][], theme: TemplateTheme): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: hairline(),
    rows: pairs.map(
      ([k, v], idx) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 120, right: 120 },
              shading: { type: ShadingType.CLEAR, fill: theme.tint, color: "auto" },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [new TextRun({ text: k, bold: true, size: 19, color: INK })],
                }),
              ],
            }),
            new TableCell({
              margins: { top: 90, bottom: 90, left: 120, right: 120 },
              shading:
                idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: "FAFAFB", color: "auto" } : undefined,
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [new TextRun({ text: v, size: 19, color: INK })],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function coverPage(title: string, meta: DocxMeta, theme: TemplateTheme): (Paragraph | Table)[] {
  const today = new Date().toLocaleDateString(undefined, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const pairs: [string, string][] = [];
  if (meta.projectName) pairs.push(["Project", meta.projectName]);
  if (meta.documentType) pairs.push(["Document Type", meta.documentType]);
  if (meta.templateName) pairs.push(["Format", meta.templateName]);
  pairs.push(["Version", meta.version ?? "1.0"]);
  pairs.push(["Date", today]);
  pairs.push(["Status", "Draft for review"]);

  return [
    new Paragraph({ spacing: { before: 1400, after: 0 }, children: [] }),
    // Accent rule above the title — the cheapest way to make a Word document
    // look designed rather than typed.
    new Paragraph({
      spacing: { before: 0, after: 220 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: theme.accent } },
      children: [],
    }),
    new Paragraph({
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: title, bold: true, size: 60, color: INK })],
    }),
    ...(meta.documentType
      ? [
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [
              new TextRun({
                text: meta.documentType.toUpperCase(),
                bold: true,
                size: 24,
                color: theme.accent,
                characterSpacing: 60,
              }),
            ],
          }),
        ]
      : []),
    ...(meta.templateName
      ? [
          new Paragraph({
            spacing: { before: 0, after: 900 },
            children: [new TextRun({ text: meta.templateName, size: 20, color: MUTED })],
          }),
        ]
      : [new Paragraph({ spacing: { after: 900 }, children: [] })]),

    new Paragraph({
      spacing: { before: 0, after: 140 },
      children: [
        new TextRun({ text: "DOCUMENT CONTROL", bold: true, size: 18, color: MUTED, characterSpacing: 40 }),
      ],
    }),
    metaTable(pairs, theme),

    new Paragraph({
      spacing: { before: 400, after: 0 },
      children: [
        new TextRun({
          text: "This document is confidential and intended for the named project stakeholders.",
          size: 17,
          color: MUTED,
          italics: true,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

export async function markdownToDocxBuffer(
  title: string,
  markdown: string,
  meta: DocxMeta = {}
): Promise<Buffer> {
  const theme = meta.theme ?? DEFAULT_THEME;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const children: (Paragraph | Table)[] = [...coverPage(title, meta, theme)];

  let i = 0;
  // Skip a leading H1 that just restates the title, so it isn't rendered twice.
  const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
  if (firstNonEmpty !== -1) {
    const leadingH1 = lines[firstNonEmpty].match(/^#\s+(.*)/);
    if (leadingH1 && leadingH1[1].trim().toLowerCase() === title.trim().toLowerCase()) {
      i = firstNonEmpty + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (isTableRow(line)) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && isTableRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }
      const rows = tableLines.filter((l) => !isTableSeparator(l)).map(parseTableRow);
      if (rows.length > 0) {
        children.push(buildTable(rows, theme));
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      }
      i = j;
      continue;
    }

    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);

    if (h3) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 220, after: 90 },
          children: [new TextRun({ text: h3[1], bold: true, size: 21, color: INK })],
        })
      );
      i++;
      continue;
    }
    if (h2) {
      // Section heading: accent colour with a rule under it, which is what
      // gives a long document visible structure when skimmed.
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 340, after: 130 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: theme.accent } },
          children: [new TextRun({ text: h2[1], bold: true, size: 26, color: theme.accent })],
        })
      );
      i++;
      continue;
    }
    if (h1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 380, after: 160 },
          children: [new TextRun({ text: h1[1], bold: true, size: 32, color: INK })],
        })
      );
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: HAIRLINE } },
          children: [],
        })
      );
      i++;
      continue;
    }

    const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/);
    if (checkbox) {
      const checked = checkbox[1].toLowerCase() === "x";
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: checked ? "☑  " : "☐  ", color: theme.accent, size: 21 }),
            ...parseInlineBold(checkbox[2]),
          ],
        })
      );
      i++;
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: 360, hanging: 180 },
          children: [
            new TextRun({ text: "•  ", color: theme.accent, bold: true, size: 21 }),
            ...parseInlineBold(bullet[1]),
          ],
        })
      );
      i++;
      continue;
    }

    const numbered = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (numbered) {
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: 360, hanging: 180 },
          children: [
            new TextRun({ text: `${numbered[1]}.  `, color: theme.accent, bold: true, size: 21 }),
            ...parseInlineBold(numbered[2]),
          ],
        })
      );
      i++;
      continue;
    }

    children.push(
      new Paragraph({ spacing: { before: 60, after: 60 }, children: parseInlineBold(line) })
    );
    i++;
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { top: { style: BorderStyle.SINGLE, size: 2, color: HAIRLINE } },
                spacing: { before: 120 },
                children: [
                  new TextRun({ text: `${title}   |   `, size: 16, color: MUTED }),
                  new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 16, color: MUTED }),
                  new TextRun({ text: " of ", size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

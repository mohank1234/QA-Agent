import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

function parseInlineBold(line: string): TextRun[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  if (parts.length === 0) return [new TextRun("")];
  return parts.map((part) =>
    part.startsWith("**") && part.endsWith("**")
      ? new TextRun({ text: part.slice(2, -2), bold: true })
      : new TextRun(part)
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

function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map((r) => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: colCount }, (_, i) => {
            const cellText = cells[i] ?? "";
            return new TableCell({
              shading: rowIndex === 0 ? { fill: "E8E8E8" } : undefined,
              children: [
                new Paragraph({
                  children: parseInlineBold(rowIndex === 0 ? `**${cellText}**` : cellText),
                }),
              ],
            });
          }),
        })
    ),
  });
}

export async function markdownToDocxBuffer(title: string, markdown: string): Promise<Buffer> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];

  let i = 0;
  // Skip a leading H1 in the content if it's essentially a restatement of the
  // title, so the document doesn't render the title twice.
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
      const dataLines = tableLines.filter((l) => !isTableSeparator(l));
      const rows = dataLines.map(parseTableRow);
      if (rows.length > 0) {
        children.push(buildTable(rows));
        children.push(new Paragraph({ text: "" }));
      }
      i = j;
      continue;
    }

    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    if (h3) {
      children.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3 }));
      i++;
      continue;
    }
    if (h2) {
      children.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2 }));
      i++;
      continue;
    }
    if (h1) {
      children.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1 }));
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) {
      children.push(new Paragraph({ text: "" }));
      i++;
      continue;
    }

    const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/);
    if (checkbox) {
      const checked = checkbox[1].toLowerCase() === "x";
      children.push(
        new Paragraph({
          children: [new TextRun(checked ? "☑  " : "☐  "), ...parseInlineBold(checkbox[2])],
          indent: { left: 360 },
        })
      );
      i++;
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      children.push(
        new Paragraph({
          children: [new TextRun("•  "), ...parseInlineBold(bullet[1])],
          indent: { left: 360 },
        })
      );
      i++;
      continue;
    }

    const numbered = line.match(/^\s*\d+\.\s+.*/);
    if (numbered) {
      children.push(
        new Paragraph({
          children: parseInlineBold(line.trim()),
          indent: { left: 360 },
        })
      );
      i++;
      continue;
    }

    children.push(new Paragraph({ children: parseInlineBold(line) }));
    i++;
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const MAX_CHARS = 60_000;

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return (
    text.slice(0, MAX_CHARS) +
    `\n\n[...truncated, ${text.length - MAX_CHARS} more characters not shown...]`
  );
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return parts.join("\n\n");
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return numA - numB;
    });

  const parts: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    parts.push(`--- Slide ${i + 1} ---\n${texts.join(" ")}`);
  }
  return parts.join("\n\n");
}

export async function extractDocumentText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return truncate(await extractPdf(buffer));
    case ".docx":
      return truncate(await extractDocx(buffer));
    case ".xlsx":
    case ".xls":
    case ".csv":
      return truncate(
        ext === ".csv" ? buffer.toString("utf-8") : extractSpreadsheet(buffer)
      );
    case ".pptx":
      return truncate(await extractPptx(buffer));
    case ".txt":
    case ".md":
      return truncate(buffer.toString("utf-8"));
    case ".doc":
    case ".ppt":
      throw new Error(
        `Legacy binary Office format "${ext}" is not supported — please re-save as ${
          ext === ".doc" ? ".docx" : ".pptx"
        } and re-upload.`
      );
    default:
      throw new Error(`Unsupported file type "${ext}".`);
  }
}

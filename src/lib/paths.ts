import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "qa-agent.sqlite");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const EXPORTS_DIR = path.join(DATA_DIR, "exports");
export const GENERATED_DIR = path.join(DATA_DIR, "generated");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function projectUploadsDir(projectId: string) {
  const dir = path.join(UPLOADS_DIR, projectId);
  ensureDir(dir);
  return dir;
}

export function projectExportsDir(projectId: string) {
  const dir = path.join(EXPORTS_DIR, projectId);
  ensureDir(dir);
  return dir;
}

export function projectGeneratedDocsDir(projectId: string) {
  const dir = path.join(GENERATED_DIR, projectId);
  ensureDir(dir);
  return dir;
}

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(EXPORTS_DIR);
ensureDir(GENERATED_DIR);

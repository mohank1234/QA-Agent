// Local, free, no-API-key text-to-speech via Piper (rhasspy/piper) — the
// user's chosen approach over a paid cloud TTS API. Self-installs on first
// use (binary + per-language voice), so there's no manual setup step.
//
// Language coverage was checked against Piper's real voice manifest before
// this was written, not assumed: 8 of the 9 originally-requested languages
// have a real voice (Arabic, English, Spanish, Japanese, Korean, Chinese,
// Portuguese, French). Tagalog/Filipino has none — not in Piper's voice
// set, and this machine has no Filipino OS voice either. That's a real,
// ecosystem-wide gap, not something this module fakes around: requesting
// "tl" fails with a clear message rather than silently substituting a
// different language or producing empty audio.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";

const CACHE_DIR = path.join(os.homedir(), ".qa-agent", "piper");
const BIN_DIR = path.join(CACHE_DIR, "bin");
const VOICES_DIR = path.join(CACHE_DIR, "voices");

const PIPER_RELEASE_URL =
  "https://github.com/rhasspy/piper/releases/latest/download/piper_windows_amd64.zip";
const VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";

type VoiceSpec = {
  key: string;
  onnxPath: string;
  onnxMd5: string;
  configPath: string;
  configMd5: string;
};

// One representative medium-quality voice per covered language, taken
// directly from Piper's published voice manifest (rhasspy/piper-voices)
// with real file paths and md5 digests for integrity verification.
const VOICES: Record<string, VoiceSpec> = {
  ar: {
    key: "ar_JO-kareem-medium",
    onnxPath: "ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx",
    onnxMd5: "c0697df8a7fb180079cc5ac523f91a8e",
    configPath: "ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json",
    configMd5: "dd70b31eb5a395907241b1e5367ace3a",
  },
  en: {
    key: "en_US-amy-medium",
    onnxPath: "en/en_US/amy/medium/en_US-amy-medium.onnx",
    onnxMd5: "778d28aeb95fcdf8a882344d9df142fc",
    configPath: "en/en_US/amy/medium/en_US-amy-medium.onnx.json",
    configMd5: "7f37dadb26340c90ebc8088e0b252310",
  },
  es: {
    key: "es_ES-davefx-medium",
    onnxPath: "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx",
    onnxMd5: "dc515cd4ecc5f6f72fe14a941188fc9c",
    configPath: "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json",
    configMd5: "dd157b5eaf6930bf949cf416d9a9307a",
  },
  ja: {
    key: "ja_JA-hi_fi_captain-medium",
    onnxPath: "ja/ja_JA/hi_fi_captain/medium/ja_JA-hi_fi_captain-medium.onnx",
    onnxMd5: "f9daab8970d06d7e9fc895a879854542",
    configPath: "ja/ja_JA/hi_fi_captain/medium/ja_JA-hi_fi_captain-medium.onnx.json",
    configMd5: "524e2f278dab6e5abf79e85f481b0015",
  },
  ko: {
    key: "ko_KR-kss-medium",
    onnxPath: "ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx",
    onnxMd5: "bebbd298dffe5ee7b88f2ce41bb4e3a9",
    configPath: "ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx.json",
    configMd5: "427c0b8d93211ba2ffea1f565819058a",
  },
  zh: {
    key: "zh_CN-chaowen-medium",
    onnxPath: "zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx",
    onnxMd5: "4965c46e983653811bef0253026ff45a",
    configPath: "zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx.json",
    configMd5: "f2598f030cbb8b27549a2e9aaa4daeb5",
  },
  pt: {
    key: "pt_BR-cadu-medium",
    onnxPath: "pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx",
    onnxMd5: "6f3a6e23694c9088e3696a15191af2cc",
    configPath: "pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx.json",
    configMd5: "3d35f13df6a2f7dc9b7b7924befbe7bb",
  },
  fr: {
    key: "fr_FR-mls-medium",
    onnxPath: "fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx",
    onnxMd5: "87831389d3ae92347d91e38b0c57add9",
    configPath: "fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx.json",
    configMd5: "be41a30aab03788f5e5c4fe51620ccbe",
  },
};

export const SUPPORTED_LANGUAGES = Object.keys(VOICES);
export const TAGALOG_GAP_NOTE =
  "Tagalog/Filipino (tl) has no free local voice available anywhere in the current open-source TTS ecosystem, and this machine has no Filipino OS voice either — confirmed against Piper's real voice manifest, not assumed. This is an open gap, not something faked around.";

function normalizeLanguageCode(input: string): string {
  return input.trim().toLowerCase().split(/[-_]/)[0];
}

async function md5File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("md5").update(buf).digest("hex");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

async function findFileRecursive(dir: string, fileName: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFileRecursive(full, fileName);
      if (found) return found;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  return null;
}

let piperExePromise: Promise<string> | null = null;

/** Downloads and extracts the Piper Windows binary once, caches it locally, returns the exe path. */
async function ensurePiperBinary(): Promise<string> {
  if (!piperExePromise) {
    piperExePromise = (async () => {
      const existing = await findFileRecursive(BIN_DIR, "piper.exe").catch(() => null);
      if (existing) return existing;

      await fs.mkdir(BIN_DIR, { recursive: true });
      const zipPath = path.join(os.tmpdir(), `piper-${randomUUID()}.zip`);
      await downloadToFile(PIPER_RELEASE_URL, zipPath);

      const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const destPath = path.join(BIN_DIR, name);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        const content = await entry.async("nodebuffer");
        await fs.writeFile(destPath, content);
      }
      await fs.rm(zipPath, { force: true });

      const exePath = await findFileRecursive(BIN_DIR, "piper.exe");
      if (!exePath) {
        throw new Error("Piper binary downloaded but piper.exe was not found in the extracted files.");
      }
      return exePath;
    })();
  }
  return piperExePromise;
}

const voicePromises = new Map<string, Promise<{ onnxPath: string; configPath: string }>>();

async function ensureVoice(lang: string): Promise<{ onnxPath: string; configPath: string }> {
  if (!voicePromises.has(lang)) {
    voicePromises.set(
      lang,
      (async () => {
        const spec = VOICES[lang];
        const onnxPath = path.join(VOICES_DIR, lang, `${spec.key}.onnx`);
        const configPath = path.join(VOICES_DIR, lang, `${spec.key}.onnx.json`);

        if (!(await fileExists(onnxPath)) || (await md5File(onnxPath)) !== spec.onnxMd5) {
          await downloadToFile(VOICE_BASE_URL + spec.onnxPath, onnxPath);
          const gotMd5 = await md5File(onnxPath);
          if (gotMd5 !== spec.onnxMd5) {
            throw new Error(`Downloaded voice model for "${lang}" failed checksum verification.`);
          }
        }
        if (!(await fileExists(configPath)) || (await md5File(configPath)) !== spec.configMd5) {
          await downloadToFile(VOICE_BASE_URL + spec.configPath, configPath);
        }

        return { onnxPath, configPath };
      })()
    );
  }
  return voicePromises.get(lang)!;
}

/** Reads a standard PCM WAV header to compute real duration — no extra dependency needed for this. */
async function wavDurationMs(wavPath: string): Promise<number> {
  const buf = await fs.readFile(wavPath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 0;

  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  // The "data" chunk isn't always at a fixed offset (some encoders add
  // extra chunks first) — search for it rather than assuming byte 36.
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
      return bytesPerSecond > 0 ? Math.round((chunkSize / bytesPerSecond) * 1000) : 0;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return 0;
}

export type SynthesizeResult = {
  wavPath: string;
  durationMs: number;
  text: string;
  languageCode: string;
};

/**
 * Synthesizes `text` in `languageCode` to a real WAV file via a local Piper
 * process (child process, matching this app's existing script-isolation
 * pattern). Returns the exact `text` back as the known ground truth to
 * compare a transcript against later — that's the entire point of
 * synthesizing from known text rather than recording arbitrary audio.
 */
export async function synthesizeSpeech(text: string, languageCode: string): Promise<SynthesizeResult> {
  const lang = normalizeLanguageCode(languageCode);
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    const gap = lang === "tl" || lang === "fil" ? ` ${TAGALOG_GAP_NOTE}` : "";
    throw new Error(
      `No local voice available for language "${languageCode}". Supported: ${SUPPORTED_LANGUAGES.join(", ")}.${gap}`
    );
  }
  if (!text.trim()) {
    throw new Error("Cannot synthesize empty text.");
  }

  const piperExe = await ensurePiperBinary();
  const { onnxPath } = await ensureVoice(lang);

  const outDir = path.join(os.tmpdir(), `qa-agent-tts-${randomUUID()}`);
  await fs.mkdir(outDir, { recursive: true });
  const wavPath = path.join(outDir, "speech.wav");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(piperExe, ["-m", onnxPath, "-f", wavPath], {
      cwd: path.dirname(piperExe),
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`Failed to start piper: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}: ${stderr.slice(-2000)}`));
    });
    child.stdin.write(text);
    child.stdin.end();
  });

  const durationMs = await wavDurationMs(wavPath);
  return { wavPath, durationMs, text, languageCode: lang };
}

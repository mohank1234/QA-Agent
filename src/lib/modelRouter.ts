// Every chat turn used to run through a single hardcoded "claude-opus-5" call
// regardless of whether the request was "how many bugs are open" or "generate
// a full IEEE-829 test plan". This module picks a cheaper Claude tier for
// turns that don't need Opus-level reasoning, using a free local classifier
// first so the decision itself costs nothing.
//
// Why not route to Gemini or a local model for the actual turn? The Claude
// Agent SDK's query() is what drives the 35-tool agentic loop (read_document,
// save_test_cases, run_browser_test, etc.) — it only knows how to talk to
// Claude models. Gemini/Ollama can't drive that same loop without a separate
// agent harness, which is a bigger future step. This module only uses a local
// model for the (tool-free, low-stakes) classification step; the turn itself
// still runs through the SDK, just at whichever Claude tier the
// classification justifies.
//
// Extension point for later: once a Gemini API key exists and its quality has
// been evaluated for real (see scripts/eval-models.mjs), a "gemini" tier can
// be added here — but only for sub-tasks that don't require the MCP tool
// loop, same constraint as above.

export type Complexity = "simple" | "moderate" | "complex";
export type ClaudeModel = "claude-haiku-4-5" | "claude-sonnet-5" | "claude-opus-5";

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "gpt-oss:20b";
const OLLAMA_TIMEOUT_MS = 2000;

function classifyPrompt(userMessage: string): string {
  return `Classify the following QA-assistant chat request into exactly one word: simple, moderate, or complex.

- simple: asking to list, show, count, or summarize data that already exists (bugs, test cases, requirements, run status, coverage).
- complex: asking to generate/write a formal Test Plan or Test Strategy document, or to judge root cause on an ambiguous test failure.
- moderate: anything else (generating test cases/scenarios, analyzing a requirement, drafting a bug report, general QA questions).

Respond with exactly one word — simple, moderate, or complex — and nothing else.

Request: """${userMessage.slice(0, 2000)}"""`;
}

export function heuristicClassify(userMessage: string): Complexity {
  const m = userMessage.toLowerCase();

  const complexPatterns = [
    /\btest\s*plan\b/,
    /\btest\s*strategy\b/,
    /\broot\s*cause\b/,
    /\biee\s*829\b/,
    /\b29119\b/,
  ];
  if (complexPatterns.some((re) => re.test(m))) return "complex";

  const simplePatterns = [
    /^(list|show|what|how many|summari[sz]e|count)\b/,
    /\bstatus\b/,
    /\bcoverage\b/,
    /\bopen bugs?\b/,
    /\bhow (many|much)\b/,
  ];
  if (simplePatterns.some((re) => re.test(m))) return "simple";

  return "moderate";
}

function isComplexity(value: string): value is Complexity {
  return value === "simple" || value === "moderate" || value === "complex";
}

async function ollamaClassify(userMessage: string): Promise<Complexity | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [{ role: "user", content: classifyPrompt(userMessage) }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const word = data.message?.content?.trim().toLowerCase().split(/\s+/)[0] ?? "";
    return isComplexity(word) ? word : null;
  } catch {
    // Ollama not running, unreachable, or timed out — fall back to the
    // heuristic rather than blocking the turn on a local model that isn't
    // there (e.g. in production, where Ollama doesn't exist at all).
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifyComplexity(userMessage: string): Promise<Complexity> {
  const viaOllama = await ollamaClassify(userMessage);
  return viaOllama ?? heuristicClassify(userMessage);
}

const TIER_ORDER: ClaudeModel[] = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"];

export function pickModel(complexity: Complexity): ClaudeModel {
  if (complexity === "simple") return "claude-haiku-4-5";
  if (complexity === "complex") return "claude-opus-5";
  return "claude-sonnet-5";
}

// Bounded to exactly one step up — never escalates past claude-opus-5, and
// never loops. Called with the turn's own error/result signals, not the
// model that ran it.
export function nextTier(model: ClaudeModel): ClaudeModel | null {
  const idx = TIER_ORDER.indexOf(model);
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

export function shouldEscalate(result: {
  isError: boolean;
  reply: string;
  documentValidationFailed?: boolean;
}): boolean {
  if (result.isError) return true;
  if (result.documentValidationFailed) return true;
  if (result.reply.trim().length < 10) return true;
  return false;
}

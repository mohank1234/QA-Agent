// Standalone script — NOT part of the app's runtime. Run manually:
//   node scripts/eval-models.mjs
//
// Runs a fixed set of representative QA tasks against every Claude tier this
// app can route to (Opus/Sonnet/Haiku, via the same Claude Agent SDK the app
// already depends on — no extra dependency, and it authenticates the same
// way the app does locally: `claude login`, no API key needed) plus the
// local Ollama model (gpt-oss:20b, already pulled), and writes every output
// side by side to a markdown file for a human to actually read and judge.
//
// This deliberately does NOT auto-score output quality — judging whether a
// generated bug report or test case is *good* QA writing needs a human QA
// reader, not a heuristic. What this script gives you is the real evidence
// (real outputs, real cost, real latency) to make that call with, per the
// project's own rule: test actual quality before routing anything to a
// cheaper tier, don't switch just because it's cheaper.
//
// Each task runs as a plain single-turn completion (no MCP tools) so the
// comparison is fair — only Claude actually drives this app's 35-tool
// agentic loop today; Ollama can't stand in for that loop yet (see
// src/lib/modelRouter.ts's header comment), so this only evaluates each
// model's raw QA reasoning/writing quality, not tool-calling behavior.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "node:fs/promises";

const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"];
const OLLAMA_MODEL = "gpt-oss:20b";
const OLLAMA_URL = "http://localhost:11434/api/chat";

const TASKS = [
  {
    name: "Requirement extraction",
    prompt: `Extract Functional Requirements, Non-functional Requirements, Business Rules, Dependencies, Risks, Assumptions, and Acceptance Criteria from this BRD excerpt. Flag anything inferred rather than stated as an assumption.

BRD excerpt:
"""
Users must be able to reset their password via email. A reset link is valid for 30 minutes. The system must support at least 500 concurrent password reset requests. Only the account owner's registered email may be used. After 3 failed reset attempts within an hour, the account is temporarily locked for 15 minutes.
"""`,
  },
  {
    name: "Test case generation",
    prompt: `Generate 5 test cases (case ID, steps, expected result, priority) for a standard login form with email + password fields and a "Forgot password" link. Cover at least one negative and one edge case.`,
  },
  {
    name: "Bug severity/priority assessment",
    prompt: `Assess severity and priority (with a one-line justification for each) for this bug: "On checkout, clicking 'Place Order' twice in quick succession creates two separate orders and charges the customer's card twice. Reproducible 3/3 times on the production-like staging environment."`,
  },
  {
    name: "Status-style question",
    prompt: `Given this data — 12 total bugs: 2 Critical (both open), 3 High (1 open, 2 in progress), 5 Medium (all open), 2 Low (both done) — answer concisely: how many bugs are currently open, and what's the highest-severity one still open?`,
  },
];

async function runClaude(model, prompt) {
  const start = Date.now();
  try {
    const stream = query({
      prompt,
      options: { model, tools: [], permissionMode: "default", cwd: process.cwd(), settingSources: [] },
    });
    let reply = "";
    let costUsd = 0;
    let isError = false;
    for await (const message of stream) {
      if (message.type === "result") {
        if (message.subtype === "success") reply = message.result;
        else isError = true;
        costUsd = message.total_cost_usd ?? 0;
      }
    }
    return { reply: isError ? "[ERROR — turn did not complete]" : reply, costUsd, ms: Date.now() - start };
  } catch (err) {
    // A transient SDK/API error (e.g. "Connection closed mid-response")
    // throws mid-stream rather than resolving to an error result — one
    // model's transient failure shouldn't abort the whole comparison run.
    return { reply: `[ERROR — ${err.message}]`, costUsd: 0, ms: Date.now() - start };
  }
}

async function runOllama(prompt) {
  const start = Date.now();
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { reply: data.message?.content ?? "[empty response]", costUsd: 0, ms: Date.now() - start };
  } catch (err) {
    return { reply: `[ERROR — Ollama unreachable: ${err.message}]`, costUsd: 0, ms: Date.now() - start };
  }
}

async function main() {
  const sections = [];
  sections.push(`# Model quality comparison\n\nGenerated ${new Date().toISOString()}. Same-provider tool-calling not evaluated here — see the header comment in this script for why.\n`);

  for (const task of TASKS) {
    console.log(`\n=== ${task.name} ===`);
    sections.push(`\n## ${task.name}\n\n**Prompt:**\n\n> ${task.prompt.replace(/\n/g, "\n> ")}\n`);

    for (const model of CLAUDE_MODELS) {
      process.stdout.write(`  ${model}... `);
      const { reply, costUsd, ms } = await runClaude(model, task.prompt);
      console.log(`done (${ms}ms, $${costUsd.toFixed(4)})`);
      sections.push(`### ${model}\n\n_${ms}ms, $${costUsd.toFixed(4)}_\n\n${reply}\n`);
    }

    process.stdout.write(`  ollama/${OLLAMA_MODEL}... `);
    const ollamaResult = await runOllama(task.prompt);
    console.log(`done (${ollamaResult.ms}ms, $0 — local)`);
    sections.push(`### ollama/${OLLAMA_MODEL} (local, free)\n\n_${ollamaResult.ms}ms_\n\n${ollamaResult.reply}\n`);
  }

  const outPath = new URL("./model-eval-results.md", import.meta.url);
  await writeFile(outPath, sections.join("\n"), "utf-8");
  console.log(`\nWrote comparison to ${outPath.pathname.replace(/^\//, "")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

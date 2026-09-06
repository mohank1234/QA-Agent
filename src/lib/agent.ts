import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { buildProjectTools, PROJECT_TOOL_NAMES, type SavedDocumentInfo } from "./agentTools";
import { getProject, setProjectSessionId } from "./db";
import { classifyComplexity, pickModel, nextTier, shouldEscalate, type ClaudeModel } from "./modelRouter";

export type AgentTurnResult = {
  reply: string;
  sessionId: string;
  costUsd: number;
  isError: boolean;
  documents: SavedDocumentInfo[];
  modelUsed: ClaudeModel;
};

type SingleTurnResult = {
  reply: string;
  sessionId: string;
  costUsd: number;
  isError: boolean;
  documentValidationFailed: boolean;
};

async function runOnce(
  projectId: string,
  userMessage: string,
  model: ClaudeModel,
  resumeSessionId: string | undefined,
  documents: SavedDocumentInfo[]
): Promise<SingleTurnResult> {
  let documentValidationFailed = false;
  const mcpServer = buildProjectTools(projectId, (doc) => documents.push(doc), () => {
    documentValidationFailed = true;
  });

  const stream = query({
    prompt: userMessage,
    options: {
      // Model is chosen per turn by classifyComplexity/pickModel below (see
      // modelRouter.ts) rather than pinned — routing exists specifically
      // because this app enforces document structure (save_document rejects
      // a Test Plan missing any of the 19 IEEE 829 sections), so "complex"
      // turns (formal Test Plan/Test Strategy generation, root-cause
      // judgment) still get claude-opus-5; simple status-style questions and
      // moderate generation tasks get cheaper tiers, with one bounded
      // escalation on failure (see shouldEscalate/nextTier).
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mcpServers: { qa: mcpServer },
      allowedTools: PROJECT_TOOL_NAMES,
      permissionMode: "default",
      resume: resumeSessionId,
      cwd: process.cwd(),
      // Full SDK isolation mode. Omitting this defaults to loading ALL
      // filesystem settings (matches the `claude` CLI's own defaults) —
      // this machine's global ~/.claude/settings.json, CLAUDE.md, and any
      // hooks/plugins registered there (confirmed live: without this, a
      // real chat turn came back referencing this developer's own unrelated
      // Claude Code session memory/observations). The QA Assistant persona
      // must only ever see this project's own system prompt, tools, and
      // documents — never the operator's personal Claude Code config.
      settingSources: [],
      // The SDK caps how much a single MCP tool result may return before
      // truncating it, independent of anything read_document itself does —
      // default is far below the 200K-char pages read_document hands back
      // (agentTools.ts), so a real multi-tab workbook or long BRD hit that
      // ceiling before ever reaching the per-document pagination this app
      // added. `env` REPLACES the subprocess environment rather than
      // merging with it (per the SDK's own docs), so process.env is spread
      // first — this subprocess still needs PATH, HOME, and the
      // `claude login` credentials to run at all.
      env: { ...process.env, MAX_MCP_OUTPUT_TOKENS: "100000" },
    },
  });

  let sessionId = resumeSessionId ?? "";
  let reply = "";
  let costUsd = 0;
  let isError = false;

  for await (const message of stream) {
    if ("session_id" in message && message.session_id) {
      sessionId = message.session_id;
    }
    if (message.type === "result") {
      if (message.subtype === "success") {
        reply = message.result;
      } else {
        isError = true;
        const detail = message.errors?.join("; ");
        reply = `The agent could not complete this turn (${message.subtype})${
          detail ? `: ${detail}` : ""
        }.`;
      }
      costUsd = message.total_cost_usd ?? 0;
    }
  }

  return { reply, sessionId, costUsd, isError, documentValidationFailed };
}

// query()'s stream can throw mid-turn (e.g. a transient "Connection closed
// mid-response" from the API) rather than resolving to an error `result`
// message — that's a distinct failure path from the isError handling inside
// runOnce above, and needs to feed the same escalation decision rather than
// bypassing it and propagating straight to the route handler's generic 500.
async function safeRunOnce(
  projectId: string,
  userMessage: string,
  model: ClaudeModel,
  resumeSessionId: string | undefined,
  documents: SavedDocumentInfo[]
): Promise<SingleTurnResult> {
  try {
    return await runOnce(projectId, userMessage, model, resumeSessionId, documents);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      reply: `The agent could not complete this turn: ${detail}`,
      sessionId: resumeSessionId ?? "",
      costUsd: 0,
      isError: true,
      documentValidationFailed: false,
    };
  }
}

export async function runAgentTurn(
  projectId: string,
  userMessage: string
): Promise<AgentTurnResult> {
  const project = await getProject(projectId);
  const resumeSessionId = project?.session_id ?? undefined;
  const documents: SavedDocumentInfo[] = [];

  const complexity = await classifyComplexity(userMessage);
  let model = pickModel(complexity);

  let result = await safeRunOnce(projectId, userMessage, model, resumeSessionId, documents);

  // Bounded to exactly one retry, one tier up — never loops, never escalates
  // past claude-opus-5. A resumed conversation keeps its session id even
  // across the retry since both calls pass the same `resume`.
  if (shouldEscalate({ isError: result.isError, reply: result.reply, documentValidationFailed: result.documentValidationFailed })) {
    const escalated = nextTier(model);
    if (escalated) {
      model = escalated;
      result = await safeRunOnce(projectId, userMessage, model, resumeSessionId, documents);
    }
  }

  if (result.sessionId && result.sessionId !== project?.session_id) {
    await setProjectSessionId(projectId, result.sessionId);
  }

  return {
    reply: result.reply,
    sessionId: result.sessionId,
    costUsd: result.costUsd,
    isError: result.isError,
    documents,
    modelUsed: model,
  };
}

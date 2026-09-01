import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { buildProjectTools, PROJECT_TOOL_NAMES, type SavedDocumentInfo } from "./agentTools";
import { getProject, setProjectSessionId } from "./db";

export type AgentTurnResult = {
  reply: string;
  sessionId: string;
  costUsd: number;
  isError: boolean;
  documents: SavedDocumentInfo[];
};

export async function runAgentTurn(
  projectId: string,
  userMessage: string
): Promise<AgentTurnResult> {
  const project = await getProject(projectId);
  const documents: SavedDocumentInfo[] = [];
  const mcpServer = buildProjectTools(projectId, (doc) => documents.push(doc));

  const stream = query({
    prompt: userMessage,
    options: {
      // Pinned deliberately. Omitting this resolves the model from whatever the
      // CLI session defaults to at runtime, which can change under us without a
      // commit — and this app enforces document structure (save_document rejects
      // a Test Plan missing any of the 19 IEEE 829 sections), so a quietly
      // swapped model shows up as validation loops with nothing in the repo to
      // explain why. Cheaper alternatives are "claude-sonnet-5" and
      // "claude-haiku-4-5"; measure a real turn's cost before switching, since
      // the tradeoff is against the structure rules above.
      model: "claude-opus-5",
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mcpServers: { qa: mcpServer },
      allowedTools: PROJECT_TOOL_NAMES,
      permissionMode: "default",
      resume: project?.session_id ?? undefined,
      cwd: process.cwd(),
    },
  });

  let sessionId = project?.session_id ?? "";
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

  if (sessionId && sessionId !== project?.session_id) {
    await setProjectSessionId(projectId, sessionId);
  }

  return { reply, sessionId, costUsd, isError, documents };
}

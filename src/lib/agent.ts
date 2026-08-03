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

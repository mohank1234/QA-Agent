import { NextResponse } from "next/server";
import { addMessage, getProject, listMessages } from "@/lib/db";
import { runAgentTurn } from "@/lib/agent";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 400 });
  }
  return NextResponse.json({ messages: listMessages(projectId) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = body?.projectId;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (typeof projectId !== "string" || !getProject(projectId)) {
    return NextResponse.json({ error: "Unknown project." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  addMessage(projectId, "user", message);

  try {
    const result = await runAgentTurn(projectId, message);
    addMessage(projectId, "assistant", result.reply, result.documents);
    return NextResponse.json({
      reply: result.reply,
      costUsd: result.costUsd,
      isError: result.isError,
      documents: result.documents,
    });
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    addMessage(projectId, "assistant", `Error: ${errorText}`);
    return NextResponse.json({ error: errorText }, { status: 500 });
  }
}

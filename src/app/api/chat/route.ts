import { NextResponse } from "next/server";
import { addMessage, listMessages } from "@/lib/db";
import { runAgentTurn } from "@/lib/agent";
import { requireProjectAccess } from "@/lib/apiAuth";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { trackEvent } from "@/lib/analytics";

// Chat is deliberately kept off the deployed site: it's billed per-call via
// the Claude API, and the whole point of running this app on Vercel is to
// stay at $0. Locally it works for free by picking up this machine's
// `claude login` session instead. Vercel sets VERCEL=1 in every one of its
// environments (production, preview, even `vercel dev`), which makes it the
// right switch here — this is not a general "are we in production" check.
const CHAT_DISABLED_ON_DEPLOYED_SITE = process.env.VERCEL === "1";
const CHAT_DISABLED_MESSAGE =
  "AI chat is disabled on the hosted site to keep this project free to run — it's only available when you run the app locally (it uses your own `claude login` session). Everything else here works normally.";

// A real agent turn commonly takes well past Vercel's default serverless
// timeout (10s on Hobby without Fluid Compute) — this app has seen turns
// take 25-50+ seconds in testing. Requests the max Vercel allows for the
// plan it's deployed on; ignored entirely outside Vercel (local dev/start).
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;
  return NextResponse.json({
    messages: await listMessages(projectId!),
    chatDisabled: CHAT_DISABLED_ON_DEPLOYED_SITE,
  });
}

const MAX_MESSAGE_CHARS = 20_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = body?.projectId;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  const access = await requireProjectAccess(typeof projectId === "string" ? projectId : null);
  if (!access.ok) return access.response;

  if (CHAT_DISABLED_ON_DEPLOYED_SITE) {
    return NextResponse.json({ error: CHAT_DISABLED_MESSAGE, disabled: true }, { status: 503 });
  }

  // Each turn is a real, billed Claude API call — worth limiting even for an
  // authenticated user, so one runaway client/script can't rack up cost.
  const limit = checkRateLimit(`chat:${access.userId}`, 20, 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  // Anonymous access has no signup step to already gate abuse, and a
  // guest's whole project only lives 1 hour anyway — the per-minute limit
  // above alone doesn't bound total cost over that window (20/min for the
  // full hour would still be 1,200 billed calls). Deliberately conservative
  // default, easy to tune: 10 messages per guest per hour, keyed by both
  // guestId and IP so clearing cookies doesn't reset the budget.
  if (access.isGuest) {
    const hourlyByGuest = checkRateLimit(`chat-guest-hourly:${access.userId}`, 10, 60 * 60 * 1000);
    if (!hourlyByGuest.allowed) return rateLimitResponse(hourlyByGuest.retryAfterSeconds);
    const hourlyByIp = checkRateLimit(`chat-guest-hourly-ip:${clientIp(req)}`, 10, 60 * 60 * 1000);
    if (!hourlyByIp.allowed) return rateLimitResponse(hourlyByIp.retryAfterSeconds);
  }

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message too long — max ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
      { status: 400 }
    );
  }

  await addMessage(projectId, "user", message);

  try {
    const result = await runAgentTurn(projectId, message);
    await addMessage(projectId, "assistant", result.reply, result.documents);
    trackEvent(access.userId, "chat_message_sent", {
      isGuest: access.isGuest,
      costUsd: result.costUsd,
      isError: result.isError,
    });
    return NextResponse.json({
      reply: result.reply,
      costUsd: result.costUsd,
      isError: result.isError,
      documents: result.documents,
    });
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    logger.error({ err, projectId, userId: access.userId }, "agent turn failed");
    await addMessage(projectId, "assistant", `Error: ${errorText}`);
    return NextResponse.json({ error: errorText }, { status: 500 });
  }
}

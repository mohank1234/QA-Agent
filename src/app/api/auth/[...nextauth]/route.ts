import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";

export const { GET } = handlers;

// Only the credentials sign-in attempt itself is rate-limited here — session
// polling (/session), csrf token fetches, and OAuth callbacks all go through
// the same catch-all route and are either read-only or already
// provider-throttled, so limiting those too would just make normal use of
// the app (useSession() polling) start failing under legitimate load.
export async function POST(req: NextRequest) {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    const limit = checkRateLimit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  }
  return handlers.POST(req);
}

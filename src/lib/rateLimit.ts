// Fixed-window, in-memory rate limiter. Deliberately not backed by
// Redis/Upstash — single Node process, $0 infra. Known limitation: resets on
// restart and doesn't share state across multiple instances, which matters
// once/if this app runs as more than one process. Fine for the scale this
// app runs at today; swap for a shared store first if that changes.

import { logger } from "./logger";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so `buckets` doesn't grow forever across a long
// process lifetime. unref() so this timer never keeps the process alive.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
sweepTimer.unref?.();

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    // Logged here (not at each of the 6 call sites) — useful abuse/attack
    // signal, and every caller gets it automatically. `key` already encodes
    // what was limited (e.g. "signup:1.2.3.4"), not raw enough to need
    // further scrubbing.
    logger.warn({ key, limit, retryAfterSeconds }, "rate limit exceeded");
    return { allowed: false, retryAfterSeconds };
  }
  bucket.count++;
  return { allowed: true };
}

// x-forwarded-for is set by the hosting platform's proxy (Railway/Vercel/etc)
// in production; falls back to a constant key for local dev where it's
// typically absent, which just means local requests share one bucket — fine
// since it's only ever one developer hitting localhost.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return new Response(JSON.stringify({ error: "Too many requests. Try again shortly." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}

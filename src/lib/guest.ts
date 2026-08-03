import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { config } from "./config";

const COOKIE_NAME = "qa_guest_id";
// How long the browser keeps this identifier around — NOT the same thing as
// how long a guest's actual project data lives (that's a fixed 1 hour from
// creation, enforced by projects.expiresAt, never extended). A longer cookie
// just means a returning anonymous visitor keeps one identity across
// separate short-lived sessions instead of getting a fresh one every time.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

// Read-only — does not create a cookie. Use for any check where "no guest
// identity yet" is a valid, unremarkable answer (e.g. an empty project list).
export async function readGuestId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

// Creates one if absent. Only call from a path that's actually about to use
// the identity for something (creating a project) — calling this from a
// plain read path would hand out cookies to visitors who never do anything.
export async function getOrCreateGuestId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = randomUUID();
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return id;
}

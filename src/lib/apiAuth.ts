import { NextResponse } from "next/server";
import { auth } from "./auth";
import { getProject, isProjectExpired } from "./db";
import { readGuestId } from "./guest";

export type AccessResult =
  | { ok: true; userId: string; isGuest: boolean }
  | { ok: false; response: NextResponse };

// Every route below scopes its work to one project. Two ways in: a signed-in
// user who owns it, or an anonymous visitor whose guest-id cookie matches
// the project's guestId (and it hasn't expired yet — see
// GUEST_PROJECT_TTL_MS in db.ts). Same 404 ("Unknown project.") in every
// rejection case — doesn't exist, belongs to someone else, or expired — one
// response shape, so a client can't distinguish "not yours" from "doesn't
// exist" by status code.
export async function requireProjectAccess(projectId: string | null | undefined): Promise<AccessResult> {
  const notFound = () =>
    ({ ok: false, response: NextResponse.json({ error: "Unknown project." }, { status: 404 }) }) as const;

  const project = projectId ? await getProject(projectId) : undefined;
  if (!project) return notFound();

  const session = await auth();
  if (session?.user) {
    if (project.owner_id !== session.user.id) return notFound();
    return { ok: true, userId: session.user.id, isGuest: false };
  }

  const guestId = await readGuestId();
  if (!guestId || project.guest_id !== guestId || isProjectExpired(project)) return notFound();
  return { ok: true, userId: guestId, isGuest: true };
}

// For routes with no projectId at all (none currently, but kept separate
// from requireProjectAccess so a route that's genuinely just
// "any signed-in user" doesn't have to fake a projectId to use it). Unlike
// requireProjectAccess, there's no guest equivalent here — always a real
// session or nothing.
export async function requireSession(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  return { ok: true, userId: session.user.id };
}

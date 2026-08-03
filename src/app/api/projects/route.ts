import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listProjects, createProject, getProject } from "@/lib/db";
import { deleteProjectCompletely } from "@/lib/projectCleanup";
import { getOrCreateGuestId, readGuestId } from "@/lib/guest";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";
import { trackEvent } from "@/lib/analytics";

export async function GET() {
  const session = await auth();
  if (session?.user) {
    return NextResponse.json({ projects: await listProjects({ userId: session.user.id }) });
  }
  // Anonymous: an empty list is a completely normal answer (never visited,
  // or no cookie yet) — not an error, unlike the authenticated 401 case that
  // no longer applies here.
  const guestId = await readGuestId();
  if (!guestId) return NextResponse.json({ projects: [] });
  return NextResponse.json({ projects: await listProjects({ guestId }) });
}

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(200),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project name." },
      { status: 400 }
    );
  }

  const session = await auth();
  if (session?.user) {
    const project = await createProject(parsed.data.name, { userId: session.user.id });
    trackEvent(session.user.id, "project_created", { isGuest: false });
    return NextResponse.json({ project });
  }

  // Anonymous creation — capped by IP (not just guestId, which resets if the
  // visitor clears cookies) so one visitor can't spin up unlimited
  // short-lived projects.
  const limit = checkRateLimit(`guest-create-project:${clientIp(req)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const guestId = await getOrCreateGuestId();
  const project = await createProject(parsed.data.name, { guestId });
  trackEvent(guestId, "project_created", { isGuest: true });
  return NextResponse.json({ project, isGuest: true, expiresAt: project.expires_at });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const project = projectId ? await getProject(projectId) : undefined;

  const notFound = () => NextResponse.json({ error: "Unknown project." }, { status: 404 });
  if (!project) return notFound();

  const session = await auth();
  if (session?.user) {
    if (project.owner_id !== session.user.id) return notFound();
  } else {
    const guestId = await readGuestId();
    if (!guestId || project.guest_id !== guestId) return notFound();
  }

  await deleteProjectCompletely(project.id);
  return NextResponse.json({ ok: true });
}

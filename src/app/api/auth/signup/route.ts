import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";
import { trackEvent } from "@/lib/analytics";

const SignupSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

export async function POST(req: Request) {
  const limit = checkRateLimit(`signup:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid signup details." },
      { status: 400 }
    );
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Deliberately vague — do not confirm/deny which emails already have
    // accounts (avoids user enumeration).
    return NextResponse.json(
      { error: "Could not create an account with those details." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });
  trackEvent(user.id, "signup", { method: "credentials" });

  return NextResponse.json({ ok: true });
}

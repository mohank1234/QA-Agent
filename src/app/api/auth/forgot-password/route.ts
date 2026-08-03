import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/tools/email";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
  // Keyed by IP, not email — the point of this route's generic response is
  // to not reveal which emails exist, so limiting per-email would itself
  // leak that (an attacker could tell a real account from the different
  // rate-limit behavior it triggers).
  const limit = checkRateLimit(`forgot-password:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => null);
  const parsed = ForgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  // Always return the same generic response regardless of whether the email
  // is registered, and regardless of whether it's a password-less
  // (OAuth-only) account — do not let this endpoint be used to enumerate
  // which emails have accounts.
  const genericResponse = NextResponse.json({
    ok: true,
    message: "If an account exists for that email, a reset link has been sent.",
  });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return genericResponse;

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${new URL(req.url).origin}/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email!, resetUrl);

  return genericResponse;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rateLimit";

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

export async function POST(req: Request) {
  // The token itself (32 random bytes) is already infeasible to brute-force;
  // this is general abuse protection, not the primary defense.
  const limit = checkRateLimit(`reset-password:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => null);
  const parsed = ResetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }
  const { token, password } = parsed.data;

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate any other outstanding reset tokens for this user.
    prisma.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId, id: { not: resetToken.id } },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

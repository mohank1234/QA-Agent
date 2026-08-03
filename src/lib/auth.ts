import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { claimOrphanedProjects, claimGuestProjects } from "./db";
import { readGuestId } from "./guest";
import { config } from "./config";

// PrismaAdapter's declared type imports PrismaClient from the default
// "@prisma/client" package export; this project generates the client to a
// custom path (src/generated/prisma) per Prisma 7's required setup, so the
// two PrismaClient types are structurally identical but nominally distinct.
// The adapter only touches models present here (see its source — it does no
// type-level narrowing beyond what's passed in), so this cast is safe.
const adapter = PrismaAdapter(prisma as never);

// config.auth.google only gates whether we register the provider at all —
// the Google() provider call below still reads AUTH_GOOGLE_ID/SECRET itself
// via NextAuth's own env auto-inference, same as AUTH_SECRET.
const googleConfigured = config.auth.google !== null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
    // Only registered when configured — mirrors the rest of this app's
    // pattern for optional integrations (DB validation, Jira): absent
    // config means the feature quietly isn't offered, not a hard error.
    ...(googleConfigured ? [Google] : []),
  ],
  callbacks: {
    async signIn({ user }) {
      if (user?.id) {
        // One-time backfill for projects created before auth existed. Only
        // acts when this is the sole user account on the instance, so a
        // second/third real signup never inherits someone else's data —
        // see claimOrphanedProjects' own doc comment in db.ts.
        const totalUsers = await prisma.user.count();
        if (totalUsers === 1) {
          await claimOrphanedProjects(user.id);
        }

        // If this browser had an active guest session, its project(s)
        // become this user's instead of expiring — the whole point of
        // "your work stays if you sign in." Safe every time (not just
        // first-user): only touches rows matching this exact guestId
        // cookie, never another guest's or another user's data.
        const guestId = await readGuestId();
        if (guestId) {
          await claimGuestProjects(guestId, user.id);
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});

export function isGoogleAuthConfigured(): boolean {
  return googleConfigured;
}

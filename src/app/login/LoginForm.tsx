"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import {
  AuthCard,
  authInputStyle,
  authButtonStyle,
  authSecondaryButtonStyle,
  authErrorStyle,
  authFieldLabelStyle,
  authLinkRowStyle,
} from "@/components/AuthCard";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setSubmitting(false);
    if (result?.error) {
      setError("Incorrect email or password.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthCard title="Sign in" subtitle="QA Intelligence Agent">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={authFieldLabelStyle}>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={authInputStyle}
            autoComplete="email"
          />
        </div>
        <div>
          <label style={authFieldLabelStyle}>Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authInputStyle}
            autoComplete="current-password"
          />
        </div>
        {error && <div style={authErrorStyle}>{error}</div>}
        <button type="submit" disabled={submitting} style={{ ...authButtonStyle, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {googleEnabled && (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={authSecondaryButtonStyle}
        >
          Continue with Google
        </button>
      )}

      <div style={authLinkRowStyle}>
        <Link href="/signup" style={{ color: "var(--app-accent)" }}>
          Create an account
        </Link>
        <Link href="/forgot-password" style={{ color: "var(--app-accent)" }}>
          Forgot password?
        </Link>
      </div>
    </AuthCard>
  );
}

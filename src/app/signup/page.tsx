"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import {
  AuthCard,
  authInputStyle,
  authButtonStyle,
  authErrorStyle,
  authFieldLabelStyle,
} from "@/components/AuthCard";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create an account.");
        return;
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        // Account was created but sign-in failed for some reason — send them
        // to the login page rather than leaving them stuck.
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Create an account" subtitle="QA Intelligence Agent">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={authFieldLabelStyle}>Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={authInputStyle}
            autoComplete="name"
          />
        </div>
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authInputStyle}
            autoComplete="new-password"
          />
        </div>
        {error && <div style={authErrorStyle}>{error}</div>}
        <button type="submit" disabled={submitting} style={{ ...authButtonStyle, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div style={{ fontSize: 13, color: "var(--app-text-dim)" }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "var(--app-accent)" }}>
          Sign in
        </Link>
      </div>
    </AuthCard>
  );
}

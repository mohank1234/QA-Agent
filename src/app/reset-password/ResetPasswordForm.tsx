"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AuthCard,
  authInputStyle,
  authButtonStyle,
  authErrorStyle,
  authFieldLabelStyle,
} from "@/components/AuthCard";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not reset your password.");
        return;
      }
      router.push("/login");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset your password">
        <div style={authErrorStyle}>
          This reset link is missing its token.{" "}
          <Link href="/forgot-password" style={{ color: "var(--app-accent)" }}>
            Request a new one
          </Link>
          .
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={authFieldLabelStyle}>New password</label>
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
        <div>
          <label style={authFieldLabelStyle}>Confirm new password</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={authInputStyle}
            autoComplete="new-password"
          />
        </div>
        {error && <div style={authErrorStyle}>{error}</div>}
        <button type="submit" disabled={submitting} style={{ ...authButtonStyle, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "Saving…" : "Reset password"}
        </button>
      </form>
    </AuthCard>
  );
}

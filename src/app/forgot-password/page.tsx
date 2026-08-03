"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AuthCard,
  authInputStyle,
  authButtonStyle,
  authErrorStyle,
  authFieldLabelStyle,
} from "@/components/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessage(data.message ?? "If an account exists for that email, a reset link has been sent.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email and we'll send you a reset link.">
      {message ? (
        <div style={{ fontSize: 13 }}>{message}</div>
      ) : (
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
          {error && <div style={authErrorStyle}>{error}</div>}
          <button type="submit" disabled={submitting} style={{ ...authButtonStyle, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <div style={{ fontSize: 13, color: "var(--app-text-dim)" }}>
        <Link href="/login" style={{ color: "var(--app-accent)" }}>
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

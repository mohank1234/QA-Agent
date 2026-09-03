import Link from "next/link";

const FEATURES = [
  { icon: "🔍", text: "Turns a BRD or spec into requirements, test scenarios, and traceable test cases" },
  { icon: "▶", text: "Runs real Playwright and API tests against your app — not just generated scripts" },
  { icon: "🐞", text: "Files bug reports from actual failures, evidence attached automatically" },
];

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app-auth-shell">
      <div className="app-auth-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "rgba(255,255,255,0.16)",
              border: "1px solid rgba(255,255,255,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            QA
          </div>
          <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: "-0.01em" }}>QA Assistant</span>
        </div>

        <div>
          <h2 style={{ fontSize: 28, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            Your QA engineer,
            <br />
            available around the clock.
          </h2>
          <p style={{ fontSize: 14.5, color: "rgba(255,255,255,0.82)", marginTop: 10, maxWidth: 380 }}>
            Analyze requirements, design tests, execute them for real, and report on what actually happened.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {FEATURES.map((f) => (
            <div key={f.text} className="app-auth-feature">
              <span className="app-auth-feature-icon" aria-hidden>
                {f.icon}
              </span>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="app-auth-form-side">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <Link
            href="/"
            className="app-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--app-text-dim)",
              marginBottom: 28,
            }}
          >
            <span aria-hidden>←</span> Back to QA Assistant
          </Link>

          <div style={{ marginBottom: 22 }}>
            <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</h1>
            {subtitle && (
              <p style={{ fontSize: 13.5, color: "var(--app-text-dim)", marginTop: 5 }}>{subtitle}</p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export const authErrorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--app-danger)",
  background: "var(--app-danger-soft)",
  borderRadius: 8,
  padding: "8px 10px",
};

export const authFieldLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--app-text-dim)",
  marginBottom: 6,
  display: "block",
};

export const authLinkRowStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--app-text-dim)",
  display: "flex",
  justifyContent: "space-between",
};

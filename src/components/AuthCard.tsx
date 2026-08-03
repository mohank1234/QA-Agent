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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-bg)",
        color: "var(--app-text)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--app-panel)",
          border: "1px solid var(--app-border)",
          borderRadius: 12,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: "var(--app-text-dim)", marginTop: 4 }}>{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export const authInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 8,
  border: "1px solid var(--app-border)",
  background: "var(--app-bg)",
  color: "var(--app-text)",
  fontSize: 14,
};

export const authButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  borderRadius: 8,
  border: "none",
  background: "var(--app-accent)",
  color: "var(--app-accent-text)",
  fontSize: 14,
  cursor: "pointer",
};

export const authSecondaryButtonStyle: React.CSSProperties = {
  ...authButtonStyle,
  background: "transparent",
  color: "var(--app-text)",
  border: "1px solid var(--app-border)",
};

export const authErrorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--app-danger)",
};

export const authFieldLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--app-text-dim)",
  marginBottom: 4,
  display: "block",
};

export const authLinkRowStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--app-text-dim)",
  display: "flex",
  justifyContent: "space-between",
};

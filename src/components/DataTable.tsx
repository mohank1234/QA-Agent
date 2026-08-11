export type ColumnDef = {
  key: string;
  label: string;
  width?: string;
};

// A cell whose value is a list of {label, url} renders as links rather than
// String()'d into "[object Object]" — used by the evidence/attachment columns,
// where the whole point is being able to open the artifact.
function asLinks(value: unknown): { label: string; url: string }[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const links = value.filter(
    (v): v is { label: string; url: string } =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { label?: unknown }).label === "string" &&
      typeof (v as { url?: unknown }).url === "string"
  );
  return links.length === value.length ? links : null;
}

export function DataTable({
  columns,
  rows,
  emptyLabel,
}: {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--app-text-dim)" }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  position: "sticky",
                  top: 0,
                  background: "var(--app-panel)",
                  borderBottom: "2px solid var(--app-border)",
                  textAlign: "left",
                  padding: "8px 12px",
                  whiteSpace: "nowrap",
                  color: "var(--app-text-dim)",
                  fontWeight: 600,
                  minWidth: col.width,
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--app-border)" }}>
              {columns.map((col) => {
                const value = row[col.key];
                const links = asLinks(value);
                const display =
                  typeof value === "number" && col.key === "is_assumption"
                    ? value
                      ? "Yes"
                      : "No"
                    : value === null || value === undefined
                      ? ""
                      : String(value);
                return (
                  <td
                    key={col.key}
                    style={{
                      padding: "8px 12px",
                      verticalAlign: "top",
                      whiteSpace: "pre-wrap",
                      maxWidth: 360,
                    }}
                  >
                    {links ? (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {links.map((l) => (
                          <a
                            key={l.url}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--app-accent)", textDecoration: "underline" }}
                          >
                            {l.label}
                          </a>
                        ))}
                      </span>
                    ) : (
                      display
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

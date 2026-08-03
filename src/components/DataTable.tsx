export type ColumnDef = {
  key: string;
  label: string;
  width?: string;
};

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
                    {display}
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

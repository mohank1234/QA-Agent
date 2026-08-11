export type ColumnDef = {
  key: string;
  label: string;
  width?: string;
};

// Columns whose value is a status/severity/priority rather than prose. These
// render as coloured pills: in a wide QA table the outcome is the thing the
// eye should find first, and plain text in a sea of plain text does not do
// that.
const PILL_COLUMNS = new Set([
  "status",
  "result",
  "severity",
  "priority",
  "pass_fail",
  "run_status",
  "frequency",
  "is_assumption",
]);

// Timestamps arrive as ISO strings. Raw, they wrap onto two lines and read as
// machine output; a QA sheet wants "when", not a serialization format.
function formatWhen(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type PillTone = "pass" | "fail" | "warn" | "info" | "neutral";

function toneFor(value: string): PillTone {
  const v = value.trim().toLowerCase();
  if (["pass", "passed", "done", "closed", "fixed", "yes"].includes(v)) return "pass";
  if (["fail", "failed", "critical", "p1", "blocked", "open", "new"].includes(v)) return "fail";
  if (["high", "p2", "partial", "retest", "in progress", "intermittent"].includes(v)) return "warn";
  if (["medium", "p3", "running", "qa testing", "ready for uat", "to do"].includes(v)) return "info";
  return "neutral";
}

function Pill({ value }: { value: string }) {
  return <span className={`app-pill app-pill-${toneFor(value)}`}>{value}</span>;
}

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
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 40,
          textAlign: "center",
          color: "var(--app-text-dim)",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "var(--app-surface)",
            border: "1px dashed var(--app-border-strong)",
            fontSize: 20,
          }}
          aria-hidden
        >
          ◇
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}>{emptyLabel}</div>
        <div style={{ fontSize: 12.5, maxWidth: 340 }}>
          Ask the agent in the Chat tab and anything it saves will appear here.
        </div>
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
                  zIndex: 1,
                  background: "var(--app-panel)",
                  borderBottom: "1px solid var(--app-border-strong)",
                  boxShadow: "0 1px 0 var(--app-border)",
                  textAlign: "left",
                  padding: "10px 12px",
                  whiteSpace: "nowrap",
                  color: "var(--app-text-dim)",
                  fontWeight: 600,
                  fontSize: 11.5,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
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
            <tr
              key={i}
              className="app-table-row"
              style={{ borderBottom: "1px solid var(--app-border)" }}
            >
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
                const showPill = PILL_COLUMNS.has(col.key) && display !== "";
                const when = !showPill && !links ? formatWhen(display) : null;
                return (
                  <td
                    key={col.key}
                    style={{
                      padding: "9px 12px",
                      verticalAlign: "top",
                      whiteSpace: "pre-wrap",
                      maxWidth: 360,
                      // IDs read as identifiers, not prose — monospacing them
                      // makes a column of them scannable.
                      fontFamily: col.key.endsWith("_id") ? "ui-monospace, monospace" : undefined,
                      fontSize: col.key.endsWith("_id") ? 12 : undefined,
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
                            className="app-link"
                          >
                            {l.label}
                          </a>
                        ))}
                      </span>
                    ) : showPill ? (
                      <Pill value={display} />
                    ) : when ? (
                      // Full ISO value stays on hover — precision is
                      // occasionally what you actually need from a timestamp.
                      <span title={display} style={{ whiteSpace: "nowrap" }}>
                        {when}
                      </span>
                    ) : (
                      // Long prose (steps, expected result, descriptions) is
                      // clamped: unclamped, a single multi-line steps cell
                      // stretches its whole row to 400px and only a handful of
                      // rows fit on screen. Full text stays available on hover
                      // and is never truncated in the .xlsx export.
                      <span
                        title={display.length > 90 ? display : undefined}
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {display}
                      </span>
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

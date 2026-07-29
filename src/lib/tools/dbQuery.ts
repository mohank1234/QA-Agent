const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 10_000;

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|CALL|EXEC|EXECUTE|COPY|VACUUM|REINDEX|ATTACH|DETACH|PRAGMA)\b/i;

// Replaces the contents of '...'-quoted string literals (handling doubled ''
// as an escaped quote) with a neutral placeholder, so a value like
// '%update%' in a WHERE clause doesn't false-positive the keyword/semicolon
// checks below — those checks only care about actual SQL syntax, not data.
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

export function isReadOnlyQuery(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const scrubbed = stripStringLiterals(trimmed);

  if (scrubbed.includes(";")) {
    return { ok: false, reason: "Multiple statements are not allowed — one SELECT per call." };
  }
  if (!/^(SELECT|WITH)\b/i.test(scrubbed)) {
    return { ok: false, reason: "Only SELECT (or WITH ... SELECT) statements are allowed." };
  }
  if (FORBIDDEN_KEYWORDS.test(scrubbed)) {
    return {
      ok: false,
      reason: "Query contains a data/schema-modifying keyword, which is not permitted for this read-only tool.",
    };
  }
  return { ok: true };
}

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

type EngineConfig = {
  engine: "postgres" | "mysql";
  connectionString: string;
};

function getEngineConfig(): EngineConfig | null {
  const connectionString = process.env.DATABASE_URL;
  const engine = process.env.DB_ENGINE?.toLowerCase();
  if (!connectionString || !engine) return null;
  if (engine !== "postgres" && engine !== "mysql") {
    throw new Error(`DB_ENGINE must be "postgres" or "mysql", got "${engine}".`);
  }
  return { engine, connectionString };
}

export function isDbConfigured(): boolean {
  return getEngineConfig() !== null;
}

// Lazily created, reused across calls — one pool per process.
let pgPoolPromise: Promise<import("pg").Pool> | null = null;
let mysqlPoolPromise: Promise<import("mysql2/promise").Pool> | null = null;

async function getPgPool(connectionString: string) {
  if (!pgPoolPromise) {
    pgPoolPromise = import("pg").then(
      ({ Pool }) =>
        new Pool({
          connectionString,
          statement_timeout: STATEMENT_TIMEOUT_MS,
          max: 3,
        })
    );
  }
  return pgPoolPromise;
}

async function getMysqlPool(connectionString: string) {
  if (!mysqlPoolPromise) {
    mysqlPoolPromise = import("mysql2/promise").then((mysql) =>
      mysql.createPool({ uri: connectionString, connectionLimit: 3 })
    );
  }
  return mysqlPoolPromise;
}

export async function runReadOnlyQuery(sql: string): Promise<QueryResult> {
  const config = getEngineConfig();
  if (!config) {
    throw new Error(
      "No database is configured. Set DB_ENGINE (postgres|mysql) and DATABASE_URL in .env.local to enable this tool."
    );
  }

  const guard = isReadOnlyQuery(sql);
  if (!guard.ok) {
    throw new Error(guard.reason);
  }

  if (config.engine === "postgres") {
    const pool = await getPgPool(config.connectionString);
    const result = await pool.query(sql);
    const rows = result.rows.slice(0, MAX_ROWS);
    return {
      columns: result.fields?.map((f) => f.name) ?? Object.keys(rows[0] ?? {}),
      rows,
      rowCount: result.rowCount ?? rows.length,
      truncated: (result.rowCount ?? 0) > MAX_ROWS,
    };
  }

  const pool = await getMysqlPool(config.connectionString);
  const [rowsRaw, fields] = await pool.query({ sql, timeout: STATEMENT_TIMEOUT_MS });
  const allRows = rowsRaw as Record<string, unknown>[];
  const rows = allRows.slice(0, MAX_ROWS);
  return {
    columns: (fields as { name: string }[] | undefined)?.map((f) => f.name) ?? Object.keys(rows[0] ?? {}),
    rows,
    rowCount: allRows.length,
    truncated: allRows.length > MAX_ROWS,
  };
}

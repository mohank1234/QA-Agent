import { describe, it, expect } from "vitest";
import { isReadOnlyQuery } from "./dbQuery";

describe("isReadOnlyQuery", () => {
  describe("plain SELECT statements", () => {
    it("allows a simple SELECT", () => {
      expect(isReadOnlyQuery("SELECT * FROM users").ok).toBe(true);
    });

    it("allows a SELECT with a WHERE clause and string literals", () => {
      expect(
        isReadOnlyQuery("SELECT id, name FROM users WHERE status = 'active'").ok
      ).toBe(true);
    });

    it("allows a WITH ... SELECT (non-mutating CTE)", () => {
      expect(isReadOnlyQuery("WITH t AS (SELECT 1 AS n) SELECT * FROM t").ok).toBe(true);
    });

    it("is case-insensitive about the leading SELECT/WITH keyword", () => {
      expect(isReadOnlyQuery("select * from users").ok).toBe(true);
      expect(isReadOnlyQuery("with t as (select 1) select * from t").ok).toBe(true);
    });

    it("tolerates leading/trailing whitespace and a single trailing semicolon", () => {
      expect(isReadOnlyQuery("   SELECT * FROM users  ").ok).toBe(true);
      expect(isReadOnlyQuery("SELECT * FROM users;").ok).toBe(true);
      expect(isReadOnlyQuery("SELECT * FROM users;;;").ok).toBe(true);
    });

    it("does not false-positive on a mutating word inside a string literal", () => {
      // '%update%'-style values in a WHERE clause are data, not SQL — the guard
      // strips string-literal contents before checking for forbidden keywords.
      expect(
        isReadOnlyQuery("SELECT * FROM logs WHERE message = 'please delete this row'").ok
      ).toBe(true);
      expect(isReadOnlyQuery("SELECT * FROM notes WHERE body = 'a;b'").ok).toBe(true);
    });
  });

  describe("rejects data/schema-modifying statements", () => {
    const mutations = [
      "INSERT INTO users (name) VALUES ('x')",
      "UPDATE users SET name = 'x' WHERE id = 1",
      "DELETE FROM users WHERE id = 1",
      "DROP TABLE users",
      "ALTER TABLE users ADD COLUMN x int",
      "TRUNCATE TABLE users",
      "CREATE TABLE x (id int)",
      "GRANT ALL ON users TO someone",
      "REVOKE ALL ON users FROM someone",
      "CALL some_procedure()",
      "MERGE INTO users USING x ON (1=1) WHEN MATCHED THEN UPDATE SET name = 'x'",
      // Postgres `SELECT ... INTO` / MySQL `SELECT ... INTO OUTFILE` both start
      // with SELECT and would pass every other check — INTO is explicitly
      // blocked because of this.
      "SELECT * INTO newtable FROM users",
    ];

    for (const sql of mutations) {
      it(`rejects: ${sql}`, () => {
        const result = isReadOnlyQuery(sql);
        expect(result.ok).toBe(false);
      });
    }

    it("rejects a data-modifying CTE even though the outer statement is a SELECT", () => {
      const result = isReadOnlyQuery(
        "WITH deleted AS (DELETE FROM users RETURNING *) SELECT * FROM deleted"
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("multi-statement bypass attempts (mutation smuggled after a semicolon)", () => {
    it("rejects a leading SELECT followed by a DROP", () => {
      const result = isReadOnlyQuery("SELECT * FROM users; DROP TABLE users;");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/multiple statements/i);
    });

    it("rejects the same attempt without a trailing semicolon", () => {
      const result = isReadOnlyQuery("SELECT * FROM users; DROP TABLE users");
      expect(result.ok).toBe(false);
    });

    it("rejects a semicolon-separated mutation split across lines", () => {
      const result = isReadOnlyQuery("SELECT * FROM users\n;\nDROP TABLE users");
      expect(result.ok).toBe(false);
    });

    it("rejects lowercase multi-statement smuggling too", () => {
      const result = isReadOnlyQuery("select * from users; drop table users");
      expect(result.ok).toBe(false);
    });
  });

  describe("SQL comment obfuscation", () => {
    it("rejects SEL/**/ECT — it no longer matches the required leading SELECT/WITH keyword", () => {
      // This is a well-known WAF-evasion trick for smuggling the word SELECT
      // itself past a filter. Here it backfires on the attacker: the guard's
      // ^(SELECT|WITH) check requires the literal keyword, so splitting it
      // makes the guard reject the query for a *different* reason than
      // intended ("not a SELECT") rather than treating it as an allowed one.
      const result = isReadOnlyQuery("SEL/**/ECT * FROM users");
      expect(result.ok).toBe(false);
    });

    it("still rejects a trailing '--' comment that hides a second statement, because the raw semicolon is still present", () => {
      // The guard does not strip comments before scanning — it just looks at
      // the raw characters. A semicolon anywhere before the very end of the
      // string (trailing semicolons are stripped) is treated as "multiple
      // statements", even one sitting inside a `--` comment. This is stricter
      // than necessary (it would also reject a harmless comment containing a
      // semicolon) but it is safe: nothing that contains an untrimmed `;`
      // gets through.
      const result = isReadOnlyQuery("SELECT 1 -- ; DROP TABLE users");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/multiple statements/i);
    });

    it("does not flag a harmless trailing '--' comment with no embedded semicolon", () => {
      expect(isReadOnlyQuery("SELECT * FROM users --").ok).toBe(true);
    });

    // --- Documented guard gap (not a working exploit) -----------------------
    //
    // FORBIDDEN_KEYWORDS matches keywords as contiguous text (`\bDROP\b` etc).
    // A block comment placed *inside* a keyword (e.g. "DR/**/OP") breaks that
    // contiguity, so the regex does not see "DROP" and the guard answers
    // `ok: true` for a string that a human would recognize as an attempted
    // DROP. This *is* a real gap in the guard's own pattern-matching — the
    // README's "an exotic construct could theoretically slip past a
    // regex-based guard" caveat is describing exactly this.
    //
    // It is NOT, however, a working bypass against a real database: SQL
    // comments only ever act as token separators, they never splice two
    // fragments back into one keyword. "DR/**/OP" is lexically the two
    // tokens "DR" and "OP", which is invalid SQL syntax. This was verified
    // against a real local PostgreSQL 16 instance while writing this test:
    //
    //   > WITH x AS (SELECT 1) DR/**/OP TABLE users;
    //   ERROR:  syntax error at or near "DR"
    //
    // ...and the target table was left untouched. So `runReadOnlyQuery` would
    // forward this string and get a syntax error back from Postgres/MySQL
    // rather than actually dropping anything — the database's own parser is
    // the layer that actually stops this input, not this guard. Documenting
    // the guard's actual (over-permissive) answer here so this gap doesn't
    // regress silently, without treating it as a live, exploitable bypass.
    it("GAP: does not detect a forbidden keyword split by a block comment (relies on the DB's own parser to reject it)", () => {
      const result = isReadOnlyQuery("WITH x AS (SELECT 1) DR/**/OP TABLE users");
      expect(result.ok).toBe(true);
    });

    it("still catches a comment placed *between* two whole keywords rather than inside one", () => {
      // Unlike the mid-word split above, a comment between complete tokens
      // doesn't change which words appear in the string, so the keyword scan
      // still finds "DROP" intact.
      const result = isReadOnlyQuery("SELECT 1; DROP/**/TABLE users");
      expect(result.ok).toBe(false);
    });
  });
});

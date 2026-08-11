import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Unit tests only — everything here is pure logic with no database, no
    // network, and no browser, so the suite stays fast enough to run on every
    // change. The execution paths themselves are exercised against real
    // Postgres/R2/Chromium rather than mocked.
    include: ["src/**/*.test.ts"],
    environment: "node",
    // src/lib/config.ts validates the environment at module load and throws if
    // anything is missing, so importing almost any lib module transitively
    // requires these to exist. Deliberately fake: no test here opens a
    // connection, and the suite must not depend on real credentials being
    // present (or, worse, quietly use production ones).
    env: {
      APP_DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      AUTH_SECRET: "test-secret-not-used-for-anything",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET_NAME: "test-bucket",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});

-- Phase 4: long-running tests and session reuse.
--
-- timeout_ms lets a saved script carry its own wall-clock ceiling: an
-- idle/session-timeout test needs 15-30 minutes, which cannot be the default
-- for every quick smoke test.
--
-- use_session / save_session name a stored Playwright storageState, so a suite
-- can share one authenticated login instead of re-authenticating per test.
-- Both nullable: null use_session means "start from a clean, logged-out
-- context", which is required behaviour for idle-timeout testing rather than
-- an unset value.
ALTER TABLE "test_scripts"
  ADD COLUMN "timeout_ms" INTEGER,
  ADD COLUMN "use_session" TEXT,
  ADD COLUMN "save_session" TEXT;

-- Phase 3: evidence capture. Storage keys for the artifacts a browser run
-- produces (Playwright trace, failure screenshot, console log, network HAR,
-- video), uploaded to R2 under runs/<run_id>/<execution_id>/.
--
-- All nullable and additive: no existing row has evidence, API executions
-- never will have browser artifacts, and a screenshot is only captured on
-- failure — so NULL is a normal, meaningful value here, not a backfill gap.
ALTER TABLE "test_executions"
  ADD COLUMN "trace_key" TEXT,
  ADD COLUMN "screenshot_key" TEXT,
  ADD COLUMN "console_log_key" TEXT,
  ADD COLUMN "har_key" TEXT,
  ADD COLUMN "video_key" TEXT;

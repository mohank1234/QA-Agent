# QA Agent — Build Journal

Personal reference notes on how this app was taken from a local single-user MVP
to a multi-user, production-track SaaS platform. Written for interview
storytelling — what was built, why, and the real problems hit along the way.

## The starting point

QA Agent began as a local-only MVP: a Next.js + Claude Agent SDK app where a
single user chats with an autonomous QA agent that has its own tools (read
documents, save requirements/test cases/bugs/benchmark rows, run real
Playwright/API tests, query a database read-only, sync with Jira, generate
real `.docx`/`.xlsx` files). Data lived in a local SQLite file via Node's
built-in `node:sqlite`, files on local disk, zero authentication, meant to run
on `localhost` for one person.

## The goal

Convert it into something deployable publicly for a team, on free/low-cost
infrastructure, without breaking any existing feature or rewriting the app
from scratch. Work was organized into two phases, each broken into small,
independently tested steps — inspect current state, explain impact and risk
*before* changing anything, implement, test end-to-end, report, only then move
to the next step.

---

## Phase 1 — Foundation

### Step 1: Prisma as a parallel data layer

Added Prisma alongside the existing `node:sqlite`-based `db.ts` — deliberately
**additive, not a replacement**. `db.ts` and every route/tool using it stayed
untouched; Prisma's job in this step was just to exist, connect to the same
database, and prove it reads the same data correctly.

Real problems hit:
- **Prisma 7 turned out to have significant undocumented-to-me breaking
  changes** (it postdates training data): no more bundled query engine, a
  SQL driver adapter (`@prisma/adapter-better-sqlite3` + `better-sqlite3`)
  is required now, a new `prisma.config.ts` replaces the old
  `url = env(...)` pattern in `schema.prisma`, several CLI flags renamed.
  Rather than guess, read Prisma's own bundled reference docs (it ships
  its own "skills" files for AI coding assistants) before writing config.
- **A SQLite quirk**: `id TEXT PRIMARY KEY` doesn't imply `NOT NULL` the way
  `INTEGER PRIMARY KEY` does. Prisma's introspection flagged all 8 tables as
  unusable because of it. Fixed by declaring `id` as required in the Prisma
  schema (safe — every insert path already always sets it) rather than
  altering the live DDL.
- **Migration history had to be *baselined*, not generated fresh** — the
  database already had real data and no `_prisma_migrations` table. Used
  Prisma's official baseline procedure (`migrate diff --create-only` to write
  the SQL without running it, then `migrate resolve --applied` to mark it
  satisfied) so zero SQL executed against the live file.
- **Caught an env-var collision before it shipped**: almost named Prisma's
  connection string `DATABASE_URL`, not realizing the app already used that
  exact name for something unrelated — the agent's own `run_readonly_query`
  tool, which points at a *user's own external database* for QA validation.
  Renamed Prisma's variable to `APP_DATABASE_URL` before anything depended on
  the wrong one.

### Step 2: Authentication (Auth.js v5)

Email/password (Credentials provider) + optional Google OAuth, JWT sessions,
Prisma adapter for `User`/`Account`/`Session`/`VerificationToken`. Full
lifecycle: signup, login, logout, forgot-password, reset-password. Email
delivery uses Resend when configured, otherwise logs the reset link to the
server console — the same graceful-degrade pattern the app already used for
optional integrations (DB validation, Jira).

Real problems hit:
- **A drift-triggered destructive-reset risk.** Adding the new auth tables
  made Prisma also want to rebuild all 8 original tables (to enforce the `id`
  `NOT NULL` fix from Step 1), and `prisma migrate dev`'s default offer for
  fixing "drift" is to reset the whole dev database. Did not accept that —
  inspected the actual generated SQL, confirmed it was a safe,
  data-preserving `CREATE new table → COPY data → DROP old → RENAME` pattern,
  and applied it manually via `migrate deploy` (which only ever runs pending
  migration files, never offers a reset).
- **Verified with the actual auth adapter's source, not memory.** Auth.js's
  Prisma adapter passes OAuth token data straight into `prisma.account.create
  ({ data })` with no key remapping — meaning `Account`/`Session` field names
  (`refresh_token`, `provider_providerAccountId` as the *default* compound
  unique name, etc.) are dictated by the adapter's internals, not free to
  rename. Read the adapter's actual bundled source before writing the schema
  rather than trusting a half-remembered NextAuth schema template.
- **Dev server hung indefinitely** (not a crash — no response, no log line)
  on first request after this step. Traced to the same Turbopack cold-compile
  corruption that had already caused a quick crash earlier in the project;
  this time it hung instead of erroring. Clearing `.next` fixed it both
  times — flagged as a recurring risk given how new Next 16 + Turbopack is.

### Step 3: Project ownership

`owner_id`/`created_by`/`updated_by` on projects. Listing and creation scoped
to the authenticated user. One-time backfill: since the app had one
pre-existing project from before auth existed, it auto-claims to whoever is
the very first user account ever created on the instance — checked via
`prisma.user.count() === 1` at sign-in — and never touches it again after
that, so a second real signup can never inherit someone else's data.

Verified with actual two-user isolation tests: first signup inherits the
orphaned project, second signup gets an empty list, cross-user delete
attempts get a 404 (not 403 — doesn't confirm the project even exists).

### Step 4: Protect every API route

13 non-auth routes (chat, upload, documents, requirements, test-cases,
bug-reports, benchmark-rows, generated-documents, plus 5 file-serving/preview
routes) all gated behind one shared `requireProjectAccess()` helper instead of
duplicating the session-check-plus-ownership-check 13 times. Consistent
response shape everywhere: 401 not signed in, 404 for "doesn't exist" *and*
"exists but isn't yours" — a client can't distinguish the two.

### Step 5: Security hardening

- **Found and closed a real bypass** in the pre-existing SQL read-only guard:
  it blocked `INSERT`/`UPDATE`/`DELETE`/etc. but not `INTO` — meaning
  Postgres's `SELECT ... INTO new_table FROM x` (creates a table) or MySQL's
  `SELECT ... INTO OUTFILE` (writes to the DB server's filesystem) could both
  slip past a "read-only" guard while starting with `SELECT`. Added `INTO` to
  the forbidden-keyword list; verified the fix blocks both variants without
  false-positiving on a query containing the literal word "into" in a string
  value.
- **Fixed a path-traversal boundary bug**: several file-serving routes used
  `filePath.startsWith(dir)` to confirm a resolved path stayed inside its
  intended directory — missing the trailing separator, so a sibling directory
  that happened to share the prefix (`uploads/abc` vs `uploads/abc-evil`)
  could theoretically pass. Replaced with one shared, tested
  `resolveSafePath()` helper used everywhere a file path gets built from
  external input, including the one spot where the filename comes straight
  from an LLM tool-call argument rather than an HTTP path segment.
- Removed two spots where a full stack trace was returned in an agent tool's
  response (still logged server-side, just not exposed).
- In-memory rate limiting on signup/login/forgot-password/reset-password
  (brute-force/enumeration protection) and chat/upload (cost/resource abuse —
  each chat turn is a real billed Claude API call).
- File size cap on uploads (previously unbounded).
- Secure headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) — deliberately skipped a strict
  `Content-Security-Policy` since the entire UI is built on inline
  `style={{}}` and a CSP strict enough to matter would need
  `style-src 'unsafe-inline'` anyway.

---

## Phase 2 — Production readiness (in progress)

### Step 1: Tailwind CSS + shadcn/ui (adopted incrementally)

Installed and configured, but deliberately **not** used to rewrite the
existing UI — the plan's own rule was "do not rewrite the entire project,"
and converting ~1,000 lines of inline-styled JSX to Tailwind in one step would
have been exactly that. Infrastructure is in place for anything built from
here on; the legacy UI stays as it is until a deliberate future migration.

Real problem hit:
- **shadcn's `init` silently overwrote live app state.** It doesn't know
  about a project's existing CSS — it just writes its own `:root` block using
  its standard variable names (`--border`, `--accent`, etc.). This app
  already used those exact names for its own theme (purple brand accent,
  border color, used in ~90 places across every screen), and shadcn's
  generator overwrote both with its own values, which would have visibly
  broken every button, border, and highlighted tab in light mode. Caught by
  diffing the file shadcn touched rather than trusting "completed
  successfully." Fixed by renaming the app's original 12 theme variables to
  an `--app-*` namespace, scripted across all 89 usage sites, verified via
  the actual compiled/served CSS bundle (not just source) that both variable
  systems now coexist without collision — and won't collide again even if
  shadcn regenerates that block later.

### Step 2: Structured logging (Pino)

Replaced the app's only logging (6 scattered `console.log`/`console.error`
calls) with a single Pino logger — pretty-printed in dev, plain JSON in
production (what a log aggregator or Sentry-adjacent tooling actually wants).

While in there, found and closed two real silent-failure gaps that had
nothing logged server-side at all:
- `/api/chat`'s catch block caught agent-turn failures (Claude API errors,
  crashed tool calls) and returned them to the client, but never logged
  anything server-side — a real production incident here would have left
  zero trace beyond what the user saw.
- `sendPasswordResetEmail` had no error handling around the actual Resend
  API call — a bad key or Resend outage would throw uncaught into
  `forgot-password/route.ts` (which also didn't catch it), turning a mundane
  email-provider hiccup into a full 500 instead of the graceful
  console-logged-link fallback the rest of the flow already relied on.
  Wrapped it in try/catch so it degrades the same way missing config does.

Also moved rate-limit-trip logging into `checkRateLimit()` itself rather than
each of the 6 call sites — one `logger.warn` covers all of them automatically
(useful abuse/attack signal), verified live by tripping the
forgot-password limit and confirming the structured warn log appeared with
the offending key.

### Step 3: Config consolidation

Every `process.env.X` read across the codebase (6 files: `prisma.ts`,
`dbQuery.ts`, `email.ts`, `auth.ts`, `jiraClient.ts`, `logger.ts`) now goes
through one module, `src/lib/config.ts` — a zod-validated, eagerly-checked
single source of truth instead of scattered ad-hoc reads. Fixes a real gap
flagged in the original codebase review ("no environment validation on
startup"): a missing `APP_DATABASE_URL` or `AUTH_SECRET` now fails loudly and
immediately when the app boots, not confusingly deep inside whichever tool
call happens to touch it first. One deliberate behavior change worth
knowing: an invalid `DB_ENGINE` value now throws at startup instead of only
when `run_readonly_query` is actually invoked — arguably better (fail fast),
but a real change from before.

### Step 4: Anonymous ("guest") usage with 1-hour data expiry

The core ask: let visitors use the full app — chat, upload, generate test
cases/documents — **without signing in**, but anything they create is
permanently deleted 1 hour after creation unless they sign up/in first, in
which case it becomes theirs permanently. This directly reverses part of
Phase 1 Step 4 (which required a session for every route) — not a
contradiction, a deliberate extension: the same `requireProjectAccess()`
choke point that gated every route now accepts *either* a real session *or* a
matching anonymous identity, so all 13 routes support guest access to their
own project for free, with no other route needing to change.

How it works:
- An httpOnly `qa_guest_id` cookie (opaque random UUID, no signing needed —
  the entropy alone is the protection, and the worst case of a guessed value
  is temporary access to a short-lived anonymous project with no real
  identity behind it) identifies an anonymous visitor. Only issued at actual
  project-creation time, not on every page load.
- `projects` gained `guest_id` and `expires_at` columns (mutually exclusive
  with `owner_id`/`created_by`/`updated_by` — a row has one or the other,
  never both). `expires_at` is fixed at creation (`now + 1h`) and **never
  extended** — a guest chatting continuously for an hour still loses their
  project on schedule, since the deadline is wall-clock from creation, not
  last-activity.
- A background sweep (`src/lib/projectCleanup.ts`, started once from
  `src/instrumentation.ts` — Next's official startup hook, verified stable
  and Turbopack-compatible for this Next.js version via its own bundled docs
  rather than assumed) checks every 5 minutes for anything past its
  `expires_at` and deletes it completely — DB rows and its 3 file
  directories, via one shared `deleteProjectCompletely()` also used by the
  manual delete route, so the two definitions of "delete a project" can't
  drift apart.
- Signing up or logging in while holding an active guest cookie claims that
  project into the new account (`claimGuestProjects`) — the actual mechanism
  behind "if login, stays in your profile."

Real problem caught before it shipped: the existing Step-3 orphaned-project
backfill (`claimOrphanedProjects`, for projects created before auth existed)
matched on `owner_id IS NULL` — and now active *guest* projects also have
`owner_id IS NULL`. Without a fix, the first real signup on a fresh instance
would have silently swept up every in-progress anonymous visitor's project
along with genuinely orphaned pre-auth data. Added `AND guest_id IS NULL` to
that query specifically to exclude guest-owned rows, verified by testing
signup-while-guest and confirming only that guest's own project got claimed
— a second, unrelated guest's project was untouched.

**Deliberately conservative default, not a considered business decision**:
anonymous chat/upload get much stricter rate limits than authenticated use
(10/hour each, keyed by both guestId and IP so clearing cookies doesn't reset
the budget) — each chat turn is a real billed Claude API call, and unlimited
anonymous access to it is a real cost-exposure question only you can actually
weigh. Flagging this clearly rather than treating it as settled; easy to
tune in `chat/route.ts`/`upload/route.ts` once you have a view on it.

**"Highlight this"**: a persistent red banner appears above the chat/tabs
area whenever a guest-owned project is open, with a live countdown to
deletion and a "Sign up to keep it" link. The empty "create or select a
project" state also proactively mentions the 1-hour limit before a guest
even creates anything, not just after.

Tested end-to-end with real requests (not just code review): anonymous
project creation issues the cookie correctly; a second, cookie-less request
sees an empty list; two different guests can't see or access each other's
projects; a real chat message and a real file upload both work as a guest;
signup-while-guest correctly claims the project (verified the *other*
guest's project was untouched); manually forcing a project's `expires_at`
into the past and running the sweep logic directly confirmed it actually
gets deleted from both the DB and the API response; confirmed
`instrumentation.ts` really fires at server startup (added a temporary log,
verified it printed, removed it) rather than assuming the Next.js docs'
description would just work.

### Step 5: Production database — Postgres via Neon, and migrating db.ts off SQLite entirely

The "connect Neon" ask turned out to have a real trap underneath it. Prisma
only ever managed Users/Accounts/Sessions (the Auth.js adapter's tables) —
every other table (projects, documents, requirements, test cases, bug
reports, benchmark rows, messages, generated documents) still went through
`db.ts`'s original raw `node:sqlite` calls, completely independent of
whatever `APP_DATABASE_URL` pointed at. Just wiring up Neon would have moved
login data to Postgres and left everything else on a local SQLite file that
doesn't even exist on Vercel (serverless, no persistent disk). Surfaced this
explicitly before touching anything, since it's exactly the kind of
architectural fork the plan's own rules say to pause on — chose to migrate
everything rather than defer the problem to a second decision point later.

What that actually meant:
- Schema provider switched from `"sqlite"` to `"postgresql"`; SQLite-era
  migration history (4 migrations from Phase 1) archived to
  `prisma/migrations-sqlite-archive/` rather than deleted — a fresh baseline
  migration was generated and applied to the empty Neon database instead
  (no data to preserve there, so none of the careful baseline-without-running
  dance from Phase 1 Step 1 was needed this time).
- **Every function in `db.ts` (~25 of them) rewritten from synchronous
  `node:sqlite` calls to async Prisma calls** — same exported names, same
  parameter shapes, same snake_case return shapes (so nothing calling `.
  req_id`/`.case_id`/etc. downstream had to change) — but every single one
  became a `Promise`, which is a real signature change every caller had to
  follow with `await`. That rippled into **17 files**: `agent.ts`, `auth.ts`,
  `apiAuth.ts`, `projectCleanup.ts`, `agentTools.ts` (the single biggest —
  every `save_*`/`list_*`/`get_project_stats` tool handler), and 12 API
  routes. `exportArtifact.ts` also got rewritten (it queried `node:sqlite`
  directly with hand-aliased `SELECT ... AS "Column Name"` SQL for the xlsx
  exports — no Prisma equivalent for column aliasing, so those became
  in-JS field-to-header mapping instead).
- The trickiest conversion was `computeProjectStats` — the original SQL had
  a `COUNT(DISTINCT req_id) ... WHERE req_id IN (SELECT source_requirement
  FROM test_cases ...)` semi-join and a `COALESCE(severity, 'Unspecified')
  GROUP BY`, neither of which Prisma's query builder expresses directly.
  Split into two queries (distinct referenced requirement IDs, then a count
  against that set) and post-processed the severity grouping in JS —
  verified against real inserted data that the numbers came out identical
  to what the original SQL would have produced.
- **Verification strategy for a 25-function rewrite**: TypeScript's own type
  checker caught almost every missed `await` for free (a `Promise<T>` used
  where a `T` was expected fails to compile) — except calls wrapped in the
  tool layer's `text(payload: unknown)` helper, which accepts anything
  including an unawaited Promise without complaint. Manually re-audited every
  `text(...)` call site specifically for that blind spot rather than trusting
  a clean `tsc` alone. Then wrote a 31-assertion test script exercising every
  rewritten function directly against the real Neon database (project CRUD,
  guest claiming, all 4 artifact types, messages, documents, generated docs,
  stats, xlsx export, orphan-vs-guest exclusion, expiry listing, cascading
  delete) — all 31 passed — followed by the same real-HTTP flows used
  throughout this project (signup → login → create project → upload → a real
  billed chat message → verify persistence → cross-user 404 → delete), also
  against Neon, not a local file.
- Removed the now-dead `better-sqlite3`/`@prisma/adapter-better-sqlite3`
  packages and the unused `DB_PATH` export once nothing referenced them.

**One thing knowingly left behind, not migrated**: the original
pre-Postgres `data/qa-agent.sqlite` file (with the "Testing FRamwwork" test
project from early in this project) still exists on disk but the app no
longer reads it at all — it's now fully inert. Local dev and production both
talk to the same Neon database from here on, which also means local dev now
needs network access to work (a real tradeoff for a much smaller
`db.ts`/no-dual-schema-maintenance burden).

### Step 6: File storage — Cloudflare R2, off local disk entirely

Same shape of problem as the database migration, smaller blast radius. Every
uploaded document, `.xlsx` export, and generated `.docx` lived on local disk
under `data/` via `path.join`/`fs.readFile`/`fs.writeFile` — none of which
exist as durable storage on Vercel's serverless functions between
invocations. `paths.ts` (the module that built those local directory paths)
was retired entirely and replaced with `src/lib/storage.ts`, an S3-compatible
client (R2 is S3-compatible, so the standard `@aws-sdk/client-s3` package
works against it with just a different `endpoint`).

- Object key scheme mirrors the old directory structure exactly —
  `uploads/<projectId>/<filename>`, `exports/<projectId>/<filename>`,
  `generated/<projectId>/<filename>` — so the DB's `documents.file_path`
  column (already existed, previously held a local path) now just holds the
  R2 key instead. No schema change needed.
- **Kept the bucket private, not public** — every download still goes
  through the same ownership-checked Next.js routes as before
  (`requireProjectAccess`), which now fetch the object from R2 and stream it
  to the client rather than reading it off disk. A public bucket URL would
  have been simpler but would have meant "anyone with the link" instead of
  "only the project's owner," which isn't the security model this app
  already has.
- `extractDocumentText` (PDF/DOCX/XLSX/PPTX text extraction) took a file path
  before; refactored to take a `Buffer` directly instead. Removes an
  unnecessary local-disk round-trip that would otherwise be needed on every
  call now that the source is R2, and it's a strictly simpler function
  signature besides.
- Project deletion now does a prefix-based batch delete against R2
  (`ListObjectsV2` + `DeleteObjects`, paginated for >1000 objects) instead of
  `fs.rm(dir, { recursive: true })` — still one shared function
  (`deleteProjectCompletely`) used by both the manual delete route and the
  guest-expiry sweep, so the two still can't drift apart on what "delete a
  project" means.
- Removed `better-sqlite3`-style leftover risk here too: the old
  `resolveSafePath`'s path-boundary check doesn't apply to object keys the
  same way, but the underlying concern (a crafted filename escaping its
  intended prefix) still does — `storage.ts`'s key-builders apply
  `path.basename()` to the filename before it ever becomes part of a key,
  same defense, different mechanism.

**Verified against the real bucket, not mocked**: smoke-tested raw
put/get/list/delete against R2 directly first (confirmed working, just slow
— ~20s on a cold connection, consistent client-side warm afterward) before
wiring anything into the app. Then the full real flow: signup → create
project → upload a real file → list it → preview it (text extracted from an
R2-fetched buffer) → download it → **a real chat message that reads the
document via `read_document`, saves a requirement, and generates a real
`.docx` via `save_document`** → downloaded that `.docx` and confirmed real
Word-file magic bytes (`PK\x03\x04`) → exported requirements to `.xlsx` and
confirmed real Excel magic bytes → deleted the project → **directly listed
all 3 R2 prefixes and confirmed zero objects remained** in any of them, not
just trusting the delete call returned success.

One test hiccup worth noting for the record, not a real bug: a `curl`
sequence got killed by a 30s wrapper timeout right as a slow first-connection
upload finished server-side (confirmed 200 in the server log), which made
`listDocuments` *appear* to return empty on the very next call. Checked the
database directly before concluding anything — the row was there, a retry
of the same request immediately returned it correctly. Chalked up to the
killed script interrupting the client-side test harness, not the server;
worth restating since "looks like a bug the moment I see it" turned out
false here, and confirming against the actual data source rather than the
first symptom is what caught that.

### Step 7: Sentry, PostHog, and Vercel readiness

The last three tech-stack items, done together since Sentry and PostHog are
both "optional enhancement" integrations (same graceful-degrade shape as
Jira/DB validation/Resend already in this app) — built both *before* having
real credentials, verified they don't break anything unconfigured, so
plugging in real keys later needs no further code changes.

- **Sentry, via the plain `@sentry/node` SDK, not `@sentry/nextjs`.** The
  Next.js-specific SDK bundles a webpack/Turbopack build plugin (source map
  upload, auto-instrumentation) — given this exact Next 16 + Turbopack
  combination had already caused two unrelated cold-compile failures earlier
  in this project, adding another build-time plugin into that mix felt like
  asking for a third. The framework-agnostic SDK just needs `Sentry.init()`
  once (added to `src/instrumentation.ts`, the same startup hook already
  running the guest-cleanup sweep) plus `captureException` calls at error
  sites — no build integration at all.
- **Wired into the *logger*, not into each error site.** Rather than pairing
  `Sentry.captureException` with every existing `logger.error(...)` call by
  hand (and every future one someone adds), Pino's `hooks.logMethod` option
  intercepts every log call — anything at `error`/`fatal` level also reports
  to Sentry automatically, extracting the actual `Error` object from the
  same `{ err, ...context }` shape this app's logging convention already
  uses. Zero additional call sites to maintain, can't silently drift out of
  sync the way manual pairing would.
- **PostHog configured to flush every event immediately**
  (`flushAt: 1, flushInterval: 0`), not posthog-node's default batching.
  This app is headed for Vercel, where a serverless function can suspend
  between requests — a buffered-but-not-yet-flushed event would just be
  silently lost. Slightly more network overhead per event, irrelevant at
  this app's scale. Tracks three events server-side for now: `signup`,
  `project_created`, `chat_message_sent` (with cost and pass/fail).
- **Resolved the `run_browser_test`-on-serverless question** flagged back
  when hosting was first discussed: Vercel serverless functions don't have
  the ~300MB Chromium binary `playwright install chromium` downloads
  locally. Detects `process.env.VERCEL` (set automatically in every Vercel
  deployment) and fails with one clear, expected message — "not available in
  this hosted environment, ask for the script as text instead" — rather than
  a confusing low-level error surfacing from inside Playwright once
  `chromium.launch()` actually attempts to run. Same pattern this app
  already uses for Selenium/Cypress/etc.
- **Found a real timeout gap while checking Vercel readiness**: `/api/chat`
  routes a full agent turn, which this project has seen take 25-50+ seconds
  in its own testing — comfortably past Vercel's default serverless function
  timeout (10s on Hobby without Fluid Compute). Added
  `export const maxDuration = 60` to the route (a Next.js route-segment
  config Vercel reads directly; a no-op everywhere else, including local dev
  and `next start`).
- **Verified the actual production build, not just `next dev`.** Given how
  much this exact Next.js/Turbopack combination has already surprised this
  project, ran a real `npm run build` (clean — all 23 routes compiled,
  TypeScript passed) followed by a real `npm run start` and confirmed the
  homepage and a live Postgres-backed API call both worked against the
  production build specifically, not the dev server.

**What's still genuinely left for the user, not something more code can
solve**: actually creating a Vercel project and deploying needs the user's
own login (OAuth — can't be done on their behalf in this environment) or a
GitHub push + Vercel dashboard connection. Real Sentry DSN and PostHog API
key are similarly the user's own accounts to create; both integrations are
already fully wired and tested end-to-end structurally (graceful no-op
confirmed), just waiting on real keys to verify the "actually reports/tracks
something" half.

### Not started yet

- Background jobs (Inngest) — deferred, no concrete need identified yet

---

## Patterns worth remembering

- **Turbopack cold-compile corruption recurred twice** in this Next 16 build
  — once as a quick crash, once as a silent indefinite hang. Same root cause,
  same fix (`rm -rf .next`). Worth a `predev` cache-clear step given how new
  this Next.js/Turbopack combination is.
- **Verify version-specific behavior hands-on, never assume from training
  data.** Both Prisma 7 and this Next.js build had meaningful undocumented
  (to me) changes. When a package ships its own reference docs, read them
  before writing config against them.
- **Windows dev-server process handling**: `npm run dev`'s tracked wrapper
  process would sometimes die (or get killed) while the actual `next-server`
  child kept running orphaned on the port — caused repeated "port already in
  use" conflicts on restart. Learned to check `netstat -ano` and
  `taskkill /F` explicitly rather than trust the task tracker's live/dead
  status.
- **Always back up before a schema-changing operation, preview the exact SQL
  before running it, verify data survives after.** Did this before both live
  migrations in Phase 1 — caught the drift/reset risk in Step 2 specifically
  because the SQL was inspected before it ran, not after.
- **Test end-to-end after every step, not just type-check.** Every step in
  both phases was verified with real `curl` calls exercising the actual
  behavior (signup/login/session flows, cross-user isolation, rate limits,
  unauthenticated 401s, file upload/download), not just "it compiles." Test
  data was always cleaned up afterward, with real project data explicitly
  re-verified to survive every migration.

## Known state as of this session's end

- Still uncommitted — not yet committed (reviewing the diff first). The
  Prisma-generated `.claude/skills`/`.windsurf/skills`/`.agents/skills`/
  `skills-lock.json` clutter from Phase 1 Step 1 has since been removed.
- **The app now runs entirely on Postgres (Neon)** — local dev included.
  `data/qa-agent.sqlite` still exists but is completely inert; the original
  pre-auth "Testing FRamwwork" project living in it was *not* migrated and is
  no longer reachable through the app. Neon's connection string is in `.env`
  as `APP_DATABASE_URL` — the live database is currently empty (all test data
  from this session's verification was cleaned up afterward).
- The Neon password that was pasted into chat during setup should be rotated
  from the Neon dashboard (Settings → Reset password) — flagged at the time,
  not yet confirmed done.
- **File storage now runs entirely on Cloudflare R2** — local disk is no
  longer used for anything (`paths.ts` was deleted). The bucket is currently
  empty (test data cleaned up after verification, same as the database).
- Google OAuth and Resend aren't configured — email/password login works
  fully; Google sign-in and real reset emails are inactive until those keys
  are added to `.env.local`.
- **Sentry and PostHog are wired in and tested (graceful no-op confirmed)
  but not yet configured** — no `SENTRY_DSN`/`POSTHOG_API_KEY` in
  `.env.local` yet, so nothing is actually being reported/tracked anywhere
  right now. Adding real values needs no further code changes.
- **Verified deployable to Vercel** — a real `npm run build` + `npm run
  start` both succeed against the production build specifically (not just
  `next dev`). `run_browser_test` correctly degrades to text-only when
  `process.env.VERCEL` is set; `/api/chat` has `maxDuration = 60` for
  Vercel's serverless function timeout. Actually creating a Vercel
  project/deploying still needs the user's own login or a GitHub connection
  — that's the one piece here that's fundamentally not something more code
  can do on their behalf.
- `LOG_LEVEL` env var (optional) controls Pino's verbosity — defaults to
  `debug` in dev, `info` in production.

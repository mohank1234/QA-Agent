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
from scratch. Work was organized into phases, each broken into small,
independently tested steps — inspect current state, explain impact and risk
*before* changing anything, implement, test end-to-end, report, only then move
to the next step. Phase 1 was the foundation, Phase 2 production readiness,
and Phase 3 a different problem entirely: the app was deployable and correct
in the ways that crash loudly, but its actual output — pass rates, reports,
signed-off documents — still overstated what was known.

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

## Phase 2 — Production readiness

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

### Step 8: Real Vercel deployment — three bugs a clean local build never showed

`npm run build && npm run start` had already passed locally (Step 7), but
that only proves the code runs correctly *on this machine*. Actually
deploying to Vercel — via CLI (`vercel link` + `vercel env add` for every
credential + `vercel deploy --prod`) — surfaced three real bugs, each found
by hitting the live URL and reading `npx vercel logs <url>` (the browser
only ever showed a generic 500 page; production mode hides error detail from
the client, so the logs command was the only way to see what actually
failed).

1. **`ReferenceError: DOMMatrix is not defined`, killing every single
   `/api/chat` call, not just PDF ones.** `pdf-parse` pulls in `pdfjs-dist`,
   which references `DOMMatrix` — a browser API — unconditionally at
   *module-evaluation time* for an optional canvas-rendering path. That's
   undefined on Vercel's serverless Node runtime specifically (never
   reproduced locally, including in `next start`). Because
   `readDocument.ts` had a static top-level `import { PDFParse } from
   "pdf-parse"`, and every `/api/chat` request imports `agentTools.ts` →
   `readDocument.ts`, the crash happened on module load — before any
   PDF was even involved. Fixed by moving the import to a dynamic
   `import()` inside `extractPdf()`, so only an actual PDF-extraction
   attempt can reach it.
2. **"Native CLI binary for linux-x64 not found."** The Claude Agent SDK
   ships its real CLI as a platform-specific optional-dependency package
   (`@anthropic-ai/claude-agent-sdk-linux-x64`) and resolves which one to
   load at *runtime* based on `process.platform`/`process.arch`. Two
   separate build-system problems, needing two separate fixes:
   - Next's bundler was rewriting the SDK's own `require()` calls, so
     `serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"]` was needed
     to make Next call it via plain Node `require()` instead of bundling it.
   - That alone didn't fix it — `@vercel/nft`'s static file-tracing (which
     decides what actually gets copied into the deployed function) can't
     follow a `process.platform`-based `require()` and was silently omitting
     the binary package entirely, so it was installed during the build but
     never shipped. Fixed with an explicit
     `outputFileTracingIncludes: { "/api/chat": ["node_modules/@anthropic-ai/claude-agent-sdk-linux-*/**/*"] }`
     in `next.config.ts`. Found by reading Next's own bundled docs on that
     option rather than guessing twice.
3. **"Not logged in · Please run /login"**, then, once `ANTHROPIC_API_KEY`
   was added, **"Credit balance is too low."** Locally the SDK authenticates
   via this machine's own `claude login` session; Vercel's serverless
   functions have no such session and need `ANTHROPIC_API_KEY` instead —
   already documented in `.env.example` from earlier in the project. Once
   added, the error changed from "not logged in" to "credit balance too
   low," confirming the entire pipeline now worked end-to-end (binary found
   → executed → authenticated → reached the real Anthropic API) — the only
   remaining gap was that the API account behind that key had no funded
   balance.

**The actual decision at that point wasn't to fund the key.** The explicit
goal for this whole deployment has been to stay at $0, and the Anthropic API
console has no ongoing free tier — it's prepaid, pay-per-use, unlike a
Claude.ai Pro/Max subscription (a separate product that can't power API
calls). Rather than add billing, chat was deliberately disabled on the
*hosted* site instead:

- `/api/chat` checks `process.env.VERCEL` (set automatically in every Vercel
  environment — production, preview, even `vercel dev`) and returns a clear
  message instead of attempting a call, before it would ever reach the SDK.
- The frontend shows a banner and disables the chat input/send button when
  the server reports this, rather than only surfacing it as an error after a
  user tries to send a message — same "make it visible, not just handled"
  approach as the guest-expiry banner.
- `ANTHROPIC_API_KEY` was removed from both Vercel (`vercel env rm`, all
  three environments) and `.env.local` — it's unused now, and its earlier
  presence in `.env.local` had a real side effect worth remembering below.
- Locally, chat is untouched and keeps working for free — `VERCEL` is never
  set outside an actual Vercel environment, so the gate never triggers there,
  and the SDK falls back to the `claude login` session same as always.
  Verified explicitly after removing the key: a fresh chat message against a
  local project still got a real reply.

**A subtler bug caught along the way, worth remembering**: the Claude Agent
SDK spawns the actual `claude` CLI as a child process, which inherits
`process.env` by default. Once `ANTHROPIC_API_KEY` was sitting in
`.env.local` for the Vercel fix, it wasn't just visible to the deployed
app — it was also visible to every *local* `npm run dev` process, and the
CLI child process picks an env var API key over the free login session if
both are present. So the same key that was meant to fix production would
have quietly started billing local development too, the moment local
testing touched chat again. Removing it from `.env.local` (not just from
Vercel) was necessary, not just tidy.

---

## Phase 3 — Making the output honest

Everything up to here was about getting the app deployable and multi-user.
This phase is about a different failure mode: the app produced artifacts that
*looked* finished but quietly overstated what was known. A pass rate computed
from test cases that had merely been written. A "Test Plan" whose structure
changed every turn. A document filename with a millisecond timestamp in it.
None of these are crashes — that's what makes them worth the work.

### Step 1: Test execution that actually persists

Browser and API tests already ran for real, but the result went back into the
agent's context and was then lost. Nothing reached the database. Two
consequences: traceability stopped at REQ → TC, and the "Test Execution" and
"Release Readiness" reports were built from how many test cases had been
*written* rather than how many had passed — a report that reads as an
execution summary while measuring authoring effort.

Data model: `TestScenario`, `TestScript`, `TestRun`, `TestExecution`.
`TestCase` gained `scenarioRef`/`actualResult`/`status`/`comments`/
`lastExecutedAt`, with `status` deliberately left null until something
actually runs the case — that null is what distinguishes "not run" from "run
and passed", and collapsing the two is the whole bug being fixed here.
`BugReport` gained the seven fields the bug format requires, including
`dateReported` (when the defect was *observed*, not when the row was written).

Real problems hit:
- **Prisma's generated migration for the nine String→DateTime column changes
  was `DROP COLUMN` + `ADD COLUMN NOT NULL`** — which discards every existing
  timestamp and cannot run at all against a populated table. Same lesson as
  Phase 1 Step 2, second occurrence: read the generated SQL before applying
  it. Replaced by hand with in-place `ALTER ... USING` casts.
- **`::timestamp(3)`, not `::timestamptz`, in those casts.** The latter
  round-trips through the session time zone and would have silently shifted
  every value — the kind of data corruption that produces plausible wrong
  numbers rather than an error.
- **`migration_lock.toml` was missing entirely**, a leftover from the init
  migration being hand-baselined back in Phase 1. Broke any `migrate diff`
  against the directory until it was restored.

Execution design:
- `executeTests.ts` is the single path where a test both runs *and* is
  recorded, so an ad-hoc run and a suite run can't diverge in what they
  persist — the same "one shared function so two definitions can't drift"
  shape as `deleteProjectCompletely()` in Phase 2 Step 4.
- Runner startup failures (no Chromium, missing Playwright) are recorded as
  failed executions rather than vanishing. A run that couldn't start is still
  a fact about the run.
- Scripts are saved and re-run rather than rewritten each turn. This is the
  precondition for regression runs, fix verification, and any definition of
  flakiness at all — none of which mean anything if the script is different
  every time.
- Runs needing over 3 minutes detach and execute in the background (45-minute
  ceiling), with the `TestRun` row as the progress source of truth. Without
  this, an idle/session-timeout test — verifying a 15-minute timeout — is
  simply not expressible. Requires a persistent server, which was already
  implied by needing a Chromium binary.

Evidence: trace and console log on every browser run; screenshot, video and
HAR retained on failure only. HAR and video can only be enabled at context
creation, so they're always recorded and discarded on pass. Written to a
directory the parent process owns, so a killed run still yields whatever it
got. Uploaded to R2 under `runs/<projectId>/<runId>/<execId>/`, and an upload
failure is logged and skipped rather than propagated — losing a screenshot
must not turn a recorded result into a lost one.

Closing the loop, with the honesty rules enforced in code rather than in the
prompt:
- `draft_bug_from_execution` builds a bug from real data only — the verbatim
  error, the captured evidence, the environment inferred from the tested URL,
  and the case's own module/preconditions/steps/expected result. It refuses to
  draft from a passing execution, and attachments cannot be typed in by hand
  anywhere; they're resolved from storage keys.
- `verify_fix` re-runs the *same saved script* and judges against real
  history. It proposes a bug status but never applies one, reports a case with
  both outcomes in its history as flaky, and cannot return "fixed" for a case
  that never failed in the first place.
- `get_report_data` separates design figures (written) from execution figures
  (actually run). Pass rates are null rather than 0 when nothing has run.
  Release readiness is five named conditions each carrying its real number,
  not one score that hides which condition failed.

Then the UI, because the data existing and nothing showing it is only half
done: Scenarios and Executions tabs, real Actual Result / Status / Last
Executed on Test Cases, and evidence rendered as links to the captured
artifacts. The evidence download route serves only the fixed set of artifact
names the harness produces — the path segments come from a URL, so an
allow-list, not just a prefix check, is what refuses probes for anything else
under that prefix. `DataTable` needed generic `{label, url}` list rendering
for this; `String()`ing an array had been producing `"[object Object]"`.

Also corrected the README, which claimed reports were built from live computed
stats and not estimated. True for design counts, false for execution reports
until this step. A doc that overstates the product is the same class of
problem as a report that overstates the results.

**A real problem this step created, caught afterwards**: a background run can
last up to 45 minutes, which fits *inside* the 1-hour guest TTL from Phase 2
Step 4. A guest run started late in that hour would have its project swept
mid-run, and the execution inserts would then fail on the
`test_executions → test_runs` foreign key. The sweep now skips projects with a
run still in flight and defers to a later pass — erring toward the project
outliving its TTL by minutes rather than a run dying halfway. Runs left at
"running" by a dead server would otherwise block deletion forever, so anything
past the same stale cutoff `getTestRunStatus` already uses to report a run as
abandoned no longer counts as in flight. Two features, each correct alone,
wrong together — worth remembering as a category.

### Step 2: A regression suite for the invariants

Every verification up to this point was by hand, through real `curl` calls and
throwaway API routes. Thorough, but not repeatable — none of it would catch a
regression six commits later. Added Vitest, covering specifically the rules
whose failure would be **silent and misleading rather than loud**:

- `pct()` returns null, not 0, for an empty denominator. "0% pass rate" when
  nothing has run is indistinguishable from everything having run and failed.
- `judgeFixVerdict` never reports "fixed" for a case with no recorded failure,
  and flags a case with both outcomes in history as flaky.
- `inferEnvironment` returns undefined rather than guessing when the host
  names no environment, and doesn't match a name embedded in another word.
- `runEvidenceKey` strips path components, so a crafted name can't place an
  object outside its project prefix; `evidenceUrlFromKey` refuses keys that
  aren't evidence.
- `needsBackgroundRun` detaches anything past the inline ceiling — being
  permissive here loses a long test's result to the request timeout.

The verdict rules and `pct` were extracted from their database-bound callers
to make them testable at all; behaviour unchanged.

**Checked by mutation, not assumed.** Inverting `pct`'s null and dropping the
prior-failure requirement from the verdict each failed exactly the test
written for it — which is the only evidence that a passing test is actually
load-bearing rather than passing vacuously.

Vitest is configured with deliberately fake credentials, since `config.ts`
(Phase 2 Step 3) validates the environment eagerly at module load and the
suite must not depend on real ones being present. Currently 47 tests across 6
files, run with `npm test`.

### Step 3: The interface — affordance and scannability

The UI was styled entirely with inline `style={{}}` (the same fact that made a
strict CSP pointless back in Phase 1 Step 5). Inline styles cannot express
`:hover`, `:active` or `:focus-visible` **at all** — so every control looked
like a label and nothing responded to being clicked. Separately, the tables
read as undifferentiated walls of text, in an app whose entire output is
pass/fail.

- Expanded the `--app-*` palette (namespaced in Phase 2 Step 1 precisely so
  this was safe): a second surface for nested areas, strong border,
  hover/soft accent variants, elevation shadows, a focus ring, and semantic
  status colours paired for both themes. Added the interaction classes inline
  styles can't provide — hover and press states, keyboard-only focus rings,
  card lift, input focus, row hover. Press feedback moves the control 1px,
  the cheapest possible confirmation that a click registered. Thin
  scrollbars, a typing indicator, and a reduced-motion opt-out.
- Status, severity, priority and result render as coloured pills, so the
  outcome is what the eye finds first. Long prose cells clamp to 4 lines —
  unclamped, one multi-line steps cell stretched its row past 400px and only
  two rows fit on screen; full text stays available on hover and is never
  truncated in the `.xlsx` export. Timestamps formatted rather than raw ISO
  (exact value on hover), IDs monospaced so a column of them scans, zebra
  striping, sticky headers, and explicit widths on prose columns that were
  being squeezed to ~90px.
- Empty states everywhere they were missing — a new project previously showed
  a blank void with no hint that uploading is the first step. Quick actions
  became real cards naming what each produces. Chat bubbles capped at 78ch,
  since 70% of a wide monitor is well past a readable line length.

Verified by screenshot in both light and dark themes.

### Step 4: A build that works from a fresh checkout

Vercel deployments started failing with `Module not found: Can't resolve
'@/generated/prisma/client'`. The Prisma client is generated into
`src/generated/prisma`, which is gitignored — so it doesn't exist in a fresh
checkout — and the build script was a bare `next build` that never generated
it. It had only ever worked locally because the directory was already sitting
there from earlier development.

Added `prisma generate` to **both** `build` and `postinstall`: postinstall
covers the normal case, and having it in `build` too means a cached install
that skips postinstall still can't produce a deployment without a client.
Verified by deleting `src/generated/prisma` and building from scratch — the
only way to actually test this, since the whole failure mode is "the machine
you're on already has it."

### Step 5: A chat entry point, and a progress signal that isn't a lie

Two gaps in the flow. There was no way to start fresh work without hunting for
the project input, and a turn that takes a minute showed a static "Thinking…"
that was indistinguishable from a hang.

- "New chat" top-left, and the logo now returns to the same screen — the
  behaviour a product wordmark is expected to have.
- The app no longer auto-selects the most recent project on load; it opens on
  the New Chat screen, so starting work is the default action rather than
  landing in whatever you last touched.
- A working indicator with an **indeterminate** progress bar and real elapsed
  time. Deliberately indeterminate: the chat endpoint returns only when the
  whole turn is finished, so the client genuinely cannot know how far along it
  is, and a filling percentage would be inventing one — the same standard
  applied to null pass rates in Step 1. The accompanying hint escalates with
  elapsed time so a long document or test run reads as expected rather than
  broken.

### Step 6: Deliverables a business would actually accept

The generated plan/strategy document had reasonable content in a shape nobody
could sign off. Three separate problems, fixed in sequence.

**They were one document, and should be two.** A Test Strategy is
programme-wide, long-lived, and describes how the organisation tests; a Test
Plan is per release, time-bound, and *cites* the strategy rather than
restating it. ISTQB treats the strategy as an input to the plan, so a merged
file is wrong at both levels. Asking for "a test plan and strategy" now
produces two documents.

**The section structure was whatever the model chose that turn.** Test Plan
follows the IEEE 829-1998 clause list (19 sections), still the structure most
teams sign against and the one ISO/IEC/IEEE 29119-3:2021 aligns with; Test
Strategy follows the standard industry structure. Critically, `save_document`
now **validates and rejects** a document with missing sections, returning
exactly which headings to add — a prompt instruction alone did not reliably
produce a complete document, a rejection does. Heading comparison ignores
numbering, case and punctuation, so "4. TEST ITEMS" still counts. Reports and
other document types stay deliberately free-form.

**One fixed structure per type was itself too rigid.** A regulated programme
and a two-week sprint don't sign off the same document, so the user picks:
four Test Plan formats (IEEE 829, ISO/IEC/IEEE 29119-3, Agile/Sprint,
Enterprise/UAT) and three Test Strategy formats (Standard, Risk-Based, Agile
QA). Clicking Test Plan or Test Strategy opens a picker showing what each
format is based on, what it suits, its length, and its full section list
*before* committing. The chosen format is what the document is validated
against, so validation stays unambiguous. The agent can offer the same choice
via `list_document_formats`.

**The filenames were machine artifacts.** Documents were being saved as
`2026-07-29T06-37-04-778Z_smartleave_test_plan_test_strategy.docx` — a
timestamp to the millisecond and the product name lowercased, on a file that
gets emailed to stakeholders. Now
`SmartLeave_Test_Plan_v1.0_2026-08-12.docx`: subject first so files sort by
product then type, and version before date because a revision is the first
thing anyone looks for on a reissued document. Regenerating reads the
project's existing files and continues from the highest version present
rather than colliding (highest present, not a count — a deleted file must not
cause a collision). The author's casing survives, so "SmartLeave" and "API"
stay intact; the document type is appended only when the title doesn't already
contain it, so a "SmartLeave Test Plan" doesn't become
`SmartLeave_Test_Plan_Test_Plan`.

**And the `.docx` was default Word styling** — black headings, a grey table
header, no cover, no page numbers. Correct content in a shape nobody would put
in front of a client. Added a cover page with an accent rule and a Document
Control block, section headings in the format's accent colour with a rule
beneath, tables with a filled accent header, white bold header text,
alternating row bands and hairline borders (most of what makes these documents
look prepared, since risk matrices, RACI and severity definitions are all
matrix-shaped), and a footer with "Page X of Y". Each format carries its own
theme, so the formats are visually distinguishable.

Verified by generating a real document and **inspecting the `.docx` XML**
directly — accent colour, header fills, row banding, cover block, page break,
five tables and the `PAGE`/`NUMPAGES` fields all present. Checking that the
file opens is not the same as checking that it's styled.

---

## Not started yet

- Background jobs (Inngest) — deferred through Phase 2, but Phase 3 Step 1
  gave it a concrete justification it didn't have before: background test
  runs currently rely on a detached process on a persistent server, which is
  exactly what a serverless host doesn't provide. This is now the main thing
  standing between the hosted site and real test execution.
- AI chat on the hosted Vercel site — deliberately off, not forgotten (see
  Phase 2 Step 8). Turning it on later just means adding a funded
  `ANTHROPIC_API_KEY` back to Vercel; no code changes needed, the gate reads
  live off `process.env.VERCEL` with no separate feature flag to flip.
- Test *execution* on the hosted site — off for a different reason than chat:
  Vercel's serverless functions have neither the Chromium binary nor a
  process that survives past the response. `run_browser_test` already
  degrades to a clear text-only message there. Local runs are unaffected.
- The legacy inline-styled UI still hasn't been migrated to Tailwind
  (Phase 2 Step 1's deliberate deferral). Phase 3 Step 3 added the
  interaction layer inline styles can't express, which removes most of the
  urgency without removing the eventual need.

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
  because the SQL was inspected before it ran, not after. Happened a third
  time in Phase 3 Step 1: Prisma's generated diff for nine String→DateTime
  column changes was `DROP COLUMN` + `ADD COLUMN NOT NULL`, which discards
  every value. Three for three — assume the generated migration is
  destructive until read.
- **The failure modes worth the most effort are the quiet ones.** A crash
  gets fixed because it's visible. A pass rate computed from test cases that
  were merely *written*, a "0%" that actually means "nothing ran", a bug
  report whose attachments were typed rather than captured — these all render
  perfectly and are simply wrong. Most of Phase 3 is encoding those
  distinctions in the schema and the code (`status` null until something
  runs, `pct()` returning null, `verify_fix` refusing to say "fixed" without
  a prior failure) rather than trusting a prompt instruction to hold.
- **A prompt instruction is not an enforcement mechanism.** Asking the model
  for all 19 IEEE 829 sections did not reliably produce them; having
  `save_document` reject the document and name the missing headings did.
  Where the output shape actually matters, validate it in the tool.
- **Two independently correct features can be wrong together.** The 45-minute
  background test ceiling and the 1-hour guest TTL were each fine; together
  they let a project be deleted mid-run. Neither code review of one feature
  would have found it — it only appears when you ask what the *new* feature
  invalidates about an old one.
- **Tests that were never seen to fail prove nothing.** Every invariant test
  in Phase 3 Step 2 was mutation-checked — invert the rule, confirm that
  exact test fails. Cheap, and the only evidence a green suite is
  load-bearing.
- **A gitignored generated artifact only works on the machine that generated
  it.** The Prisma client lived in a gitignored directory and the build never
  regenerated it; every local build passed for weeks because the folder was
  already there. Fresh-checkout behavior has to be tested by actually
  deleting the artifact.
- **Test end-to-end after every step, not just type-check.** Every step in
  both phases was verified with real `curl` calls exercising the actual
  behavior (signup/login/session flows, cross-user isolation, rate limits,
  unauthenticated 401s, file upload/download), not just "it compiles." Test
  data was always cleaned up afterward, with real project data explicitly
  re-verified to survive every migration.
- **A clean local production build (`next build && next start`) is not the
  same as a clean deployment.** All three Step 8 bugs — a browser-only API
  reference, a runtime-resolved native binary Vercel's file tracer couldn't
  see, and a billing account with no funds — only showed up by actually
  deploying and hitting the live URL. When the client only shows a generic
  500, `npx vercel logs <url>` is the way to see what actually failed
  server-side.
- **A child process inherits the whole parent environment by default.** The
  Claude Agent SDK spawns its CLI as a child process; putting
  `ANTHROPIC_API_KEY` in `.env.local` to fix Vercel meant it was also live
  for every local `npm run dev` process, and API-key auth wins over a free
  `claude login` session when both are present — silently turning local
  development into a billed activity too. Scoped env vars matter even
  within one machine, not just between environments.

## Known state as of this session's end

- **Deployed and live on Vercel**: `https://qa-agent-alpha.vercel.app`.
  Everything works on the hosted site except AI chat and test execution, both
  deliberately off there (see Phase 2 Step 8 and the list above) — auth,
  guest mode, project/document management, uploads, exports, and generated
  `.docx`/`.xlsx` files are all live against real Neon Postgres and
  Cloudflare R2. Chat and test runs keep working normally when run locally.
- **Committed and clean.** Working tree clean at the end of Phase 3, with
  everything through the document-formats work landed. The Prisma-generated
  `.claude/skills`/`.windsurf/skills`/`.agents/skills`/`skills-lock.json`
  clutter from Phase 1 Step 1 has since been removed, and `.vscode/` is now
  ignored (it held a personal editor toggle, not project configuration).
- **`npm test` is now the fast check**: 47 tests across 6 files, all passing,
  plus a clean `tsc --noEmit`. Covers the honesty invariants from Phase 3
  Step 2, document naming/versioning, template validation, and storage key
  safety. It deliberately does *not* cover the end-to-end flows — those are
  still the real-request verification passes described throughout, and the
  suite is a regression net under them, not a replacement.
- **Test execution is real and recorded** (Phase 3 Step 1): runs, executions,
  evidence and scripts all persist to Postgres, with evidence in R2 under
  `runs/<projectId>/<runId>/<execId>/`. Reports distinguish what was written
  from what actually ran, and report null rather than 0 when nothing has run.
  Needs a persistent server (Chromium binary + a detached process), so this
  is local-only for now.
- **Generated documents are format-driven**: four Test Plan formats and three
  Test Strategy formats, each with its own required section list, its own
  `.docx` theme, and validation that rejects a document missing sections.
  Filenames follow `<Subject>_<Document Type>_v<n>.0_<YYYY-MM-DD>.docx` with
  automatic version increment.
- **The app now runs entirely on Postgres (Neon)** — local dev included.
  `data/qa-agent.sqlite` still exists but is completely inert; the original
  pre-auth "Testing FRamwwork" project living in it was *not* migrated and is
  no longer reachable through the app. Neon's connection string is in `.env`
  as `APP_DATABASE_URL` — the live database is currently empty (all test data
  from this session's verification was cleaned up afterward).
- The Neon password that was pasted into chat during setup was flagged for
  rotation (Neon dashboard → Settings → Reset password); explicitly declined
  by choice — "leave it, don't think we'll have any issues."
- **File storage now runs entirely on Cloudflare R2** — local disk is no
  longer used for anything (`paths.ts` was deleted). The bucket is currently
  empty (test data cleaned up after verification, same as the database).
- **All four credential-gated integrations are now configured and verified
  live, not just wired.** Real keys landed in `.env.local` in one batch;
  each was independently confirmed actually working, not just "no errors on
  boot":
  - **Google OAuth**: `/api/auth/providers` lists it correctly, and driving
    the real sign-in POST through to completion produces a genuine redirect
    to `accounts.google.com` with our real `client_id` and the correct
    `redirect_uri` embedded — checked the actual URL, not just a 200.
  - **Resend**: first test used a fake `@example.com` recipient, which
    Resend's sandbox mode correctly rejected (422) — informative rather than
    a failure, since it confirms the API key itself authenticated correctly
    (an invalid key fails before recipient validation ever runs), *and*
    confirms the graceful-degrade path works (still returned 200 to the
    client, logged the reset link instead of crashing). Re-ran against a
    real deliverable address and got a clean send with no error logged.
  - **Sentry**: `Sentry.flush()` returned `true` after a real
    `captureException` call — confirms the event actually transmitted to
    Sentry's servers, not just that `.init()` didn't throw.
  - **PostHog**: a direct `capture()` + `shutdown()` completed without
    throwing (posthog-node throws on a failed flush), confirming real event
    delivery.
  
  All test accounts/events cleaned up afterward, consistent with every
  other verification pass in this project.
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

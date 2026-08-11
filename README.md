# QA Agent

A personal, general-purpose QA copilot. Point it at any project's requirements
documents (BRD/PRD/specs/API docs/etc.) and it analyzes them, generates
traceable test cases and RTMs, tracks bug reports (with optional Jira sync),
builds AI/RAG benchmark datasets, runs real read-only database checks, real
Playwright browser tests, and real API tests — recording every run with
captured evidence, auto-drafting defects from real failures, and verifying
fixes by re-running the same test — generates reports from live computed run
data, and exports everything to real `.xlsx` files — through a chat
UI, backed by an autonomous Claude agent with its own tools (not a fixed
script pipeline).

Built on the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview),
Next.js, Prisma + Postgres (Neon), Cloudflare R2, and Playwright.

## How it works

- Each **project** is an isolated workspace (own documents, requirements, test
  cases, bug reports, benchmark rows, chat history) — use one per
  system-under-test. Click the **×** next to a project name to delete it —
  this permanently removes its DB rows and uploaded/exported files and cannot
  be undone; you'll get a confirmation prompt first.
- Upload documents (PDF/DOCX/XLSX/XLS/CSV/PPTX/TXT/MD) via the sidebar — select
  multiple files at once in the picker, they upload one after another. No cap
  on how many documents a project can hold. Each uploaded document is a real
  download link in the sidebar (⬇ filename) — not just a label. Re-uploading
  a file with the same name replaces it rather than adding a duplicate entry.
- Chat with the agent: ask it to analyze a document, generate test cases,
  log/track bugs (and optionally file them in Jira), build a benchmark
  dataset, validate an AI response, draft a test plan or release-readiness
  report, run a live DB check, or actually execute a browser/API test.
- The agent has its own tools — it reads documents, saves what it extracts/
  generates to the database (so nothing is lost or regenerated between
  turns), computes real stats for reports (never estimates them), and
  exports to `.xlsx` on request. It decides what to do with your request;
  this isn't a fixed script.
- Conversation state persists per project across restarts (Claude Agent SDK
  session resume) — pick up where you left off.
- **Tabs above the chat** (Requirements / Scenarios / Test Cases / Executions /
  Bugs / Benchmark) show the full saved data as real tables — every field,
  every row, straight from the database — not a prose summary. The chat reply
  stays a concise narrative; the tabs are where you see the actual structured
  output. Test Cases carry their real Actual Result / Status / Last Executed
  once run, and the Executions tab links straight to each run's captured
  evidence.
- **Documents tab**: long-form deliverables (Test Plan, Test Strategy, Daily
  QA Status, Test Summary/Defect Summary/Release Readiness/Requirement
  Coverage reports) are saved as real `.docx` Word documents — headings,
  tables, bullet lists rendered properly, not raw markdown — instead of being
  pasted into the chat reply. Click **Preview** to read it in-app or
  **⬇ Download** to get the file. The chat reply itself stays a short summary
  pointing here.
- **First time in a project** (documents uploaded, no messages yet), you get
  a one-time set of buttons — Test Plan / Test Cases / Benchmark Dataset /
  Something else — instead of a blank box you have to know what to type into.
  It's still just chat underneath (each button sends a fully-formed request),
  but you don't need to know the right phrasing to get started.

## Accounts & access

- **Sign up / log in** with email+password, or Google (if `AUTH_GOOGLE_ID`/
  `AUTH_GOOGLE_SECRET` are configured — see Setup below). Each project
  belongs to exactly one account; you only ever see your own.
- **You don't have to sign in to try it.** Anonymous use is fully supported —
  upload a document, chat, generate test cases, everything works without an
  account. The catch: **anything created without signing in is permanently
  deleted 1 hour after it's created**, no exceptions, regardless of how
  active you are in that hour. A red banner with a live countdown appears
  whenever you're working on an anonymous project, with a link to sign up.
  **Sign up or log in before that hour is up and the project (and everything
  in it) becomes permanently yours instead** — nothing needs to be
  re-created.

## What's real vs. text-only

| Capability | Status |
|---|---|
| Requirement analysis, RTM, test case generation, benchmark datasets, bug reports | Persisted + exportable to `.xlsx` |
| Test Plan, Test Strategy, and all Reports (Daily Status, Test Execution, Defect Summary, Release Readiness, etc.) | Generated from live computed stats (`get_project_stats` / `get_report_data`), not estimated — saved as real `.docx` files in the Documents tab, not pasted into chat |
| Test Execution / Regression / Release Readiness figures | Computed from **real recorded test runs**, not from how many test cases were written. Design counts and execution counts are kept separate, and a project with nothing executed is reported as such rather than given a pass rate |
| Database validation | **Really executes** read-only (SELECT-only) queries when `DB_ENGINE`/`DATABASE_URL` are configured; generates SQL as text otherwise |
| Playwright browser tests | **Really executes** in a real headless Chromium child process, reports the actual pass/fail, and **persists every run** (`TestRun`/`TestExecution`) linked to its test case |
| Test evidence | **Really captured** on browser runs — Playwright trace, console log always; screenshot, video, and network HAR on failure — uploaded to R2 and attachable to bug reports. Attachments can only come from a real run; they cannot be written by hand |
| Long-running tests (idle/session timeout) | **Really supported** — runs needing more than 3 minutes detach and execute in the background (45-minute ceiling), polled via run status. Requires a persistent server (not serverless) |
| Multi-tab / multi-session tests | **Really supported** — a test body can open additional tabs sharing the session, or fully isolated contexts, and reuse a saved authenticated session across runs |
| API tests | **Really executes** via Node's built-in `fetch` + assert, no Java/Postman needed — also persisted as runs |
| Jira | **Really reads/writes** when configured (search, get, create issue, transition, comment) — writes are confirmation-gated, see below |
| Azure DevOps/GitHub Projects/Linear | Not connected — offers a Jira-equivalent text draft instead |
| Selenium/Cypress/Appium/Pytest | Not connected — generates script text only (Playwright covers real browser execution; the API test tool covers what REST Assured/Postman would) |

The agent is instructed to say plainly when something is text-only rather than implying it executed.

**Jira writes are confirmation-gated in the system prompt**, not just
API-key-gated: `jira_create_issue`/`jira_transition_issue`/`jira_add_comment`
are only called when the user explicitly asks for that exact action in their
current message — the agent will propose filing/updating a ticket and wait
for an explicit yes rather than doing it on its own initiative, since these
write to a system your teammates see.

## Setup

1. Create a free [Neon](https://neon.tech) Postgres project and copy its
   connection string.
2. Create a free [Cloudflare R2](https://dash.cloudflare.com) bucket and an
   API token scoped to it (R2 → Manage API Tokens → Create API Token,
   permissions: Object Read & Write) — this is where uploaded documents,
   `.xlsx` exports, and generated `.docx` files live.
3. Copy `.env.example` to `.env` and `.env.local`, and set `APP_DATABASE_URL`
   (the Neon connection string), `AUTH_SECRET` (generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
   and the 4 `R2_*` variables (account ID, access key ID, secret access key,
   bucket name).
4. ```bash
   npm install
   npx playwright install chromium   # one-time, ~300MB — needed for run_browser_test
   npx prisma migrate deploy         # creates the schema on your fresh Neon database
   npm run dev
   ```

Open http://localhost:3000.

**Accessing it from another device on your network/Tailscale**: Next.js
blocks cross-origin dev-server requests by default, so `localhost:3000` works
immediately but a LAN/Tailscale address (e.g. `http://100.x.x.x:3000`) will
load the page but not be interactive, with the browser console showing failed
`_next/webpack-hmr` websocket connections. Add that address's hostname (no
scheme/port) to `allowedDevOrigins` in `next.config.ts` and restart `npm run
dev` — config changes aren't picked up by hot reload.

**Authentication**: if this machine is already logged in via `claude login`
(e.g. you use Claude Code here), no further setup is needed — the agent
reuses that login automatically. Otherwise, copy `.env.example` to `.env.local`
and set `ANTHROPIC_API_KEY`.

**Database validation (optional)**: to let the agent actually run read-only
SQL instead of just generating it, add to `.env.local`:
```
DB_ENGINE=postgres   # or mysql
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```
Only `SELECT`/`WITH ... SELECT` is allowed — the tool rejects anything else
(INSERT/UPDATE/DELETE/DDL/multiple statements), checked after stripping
string-literal contents so a value like `'%update%'` in a `WHERE` clause
doesn't false-positive. Results are capped at 500 rows and a 10s statement
timeout. This is a safety guard against destructive queries, not SQL-injection
protection — there's no untrusted end-user input in this flow, the query
itself is what the agent writes.

**Jira (optional)**: to let the agent read/write real Jira issues, add to
`.env.local`:
```
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=...   # generate at https://id.atlassian.com/manage-profile/security/api-tokens
```
Jira Cloud only (Basic auth with an API token) — Jira Server/Data Center uses
a different auth scheme and isn't supported here.

**Monitoring & analytics (optional)**: both degrade gracefully to a no-op
when unset, same as everything else optional in this list.
```
SENTRY_DSN=...       # https://sentry.io — every logger.error()/logger.fatal() call also reports here when set
POSTHOG_API_KEY=...  # https://posthog.com — tracks signup/project_created/chat_message_sent server-side when set
POSTHOG_HOST=         # defaults to https://us.i.posthog.com; set if your PostHog project is EU-hosted
```

## Deployment (Vercel)

The app is deployment-ready — a real `npm run build` + `npm run start` are
both verified working. What's actually left is account-level, not code:

1. `vercel login` (or connect this repo via the Vercel dashboard) — needs
   your own login, can't be done on your behalf.
2. Set every `.env`/`.env.local` variable above as an environment variable in
   the Vercel project settings (Neon + R2 at minimum; Sentry/PostHog/Google
   OAuth/Resend/Jira/DB validation if you want those active in production).
3. Deploy. `run_browser_test` automatically degrades to text-only when
   running on Vercel (no Chromium binary in a serverless function) —
   everything else works the same as local dev.

## Data

Structured data (projects, requirements, test cases, bug reports, benchmark
rows, chat history, generated document content, user accounts) lives in
**Postgres via [Neon](https://neon.tech)**. Files (uploaded documents,
`.xlsx` exports, generated `.docx` files) live in **Cloudflare R2**
(`src/lib/storage.ts`), under key prefixes mirroring what used to be local
directories:

```
uploads/<projectId>/<filename>     <- documents you've provided, per project
exports/<projectId>/<filename>     <- generated .xlsx files, per project (never overwritten, timestamped)
generated/<projectId>/<filename>   <- generated .docx documents (Test Plan/Strategy/Reports), per project (never overwritten, timestamped)
```

Both are the same database/bucket for local dev and production, so local dev
needs network access to reach them — nothing is written to local disk
anymore.

## Database (Prisma + Postgres)

All data access goes through Prisma (`src/lib/db.ts`) against Postgres —
this app started on local SQLite via `node:sqlite` and was migrated off it
entirely; see `docs/BUILD_JOURNAL.md` for the full story if you're curious
why a given design choice exists.

- `prisma/schema.prisma` — `@map`/`@@map` keep snake_case physical
  table/column names (`req_id`, `case_id`, etc.) while the Prisma Client and
  TypeScript code use camelCase — `db.ts`'s exported functions still return
  the original snake_case shape the rest of the app (and the frontend) expects.
- **Prisma 7 requires a driver adapter** for SQL databases — there's no
  bundled engine anymore. This app uses `@prisma/adapter-pg` + `pg`.
- `APP_DATABASE_URL` (in `.env`, loaded automatically by both the Prisma CLI
  and Next.js) is a standard `postgresql://` connection string from your
  Neon project's dashboard.
- `prisma/migrations-sqlite-archive/` holds the original SQLite-era migration
  history (kept for reference, not applied to anything anymore).
  `prisma/migrations/0_init_postgres/` is the current baseline.
- `npm run db:generate` — regenerate the client after editing the schema
- `npm run db:migrate` — create/apply a new migration
- `npm run db:studio` — browse the database in Prisma Studio

## Project structure

```
src/
  components/
    DataTable.tsx              <- reusable table for the Requirements/Test Cases/Bugs/Benchmark tabs
  app/
    page.tsx                 <- UI: project selector, upload, chat + welcome screen, data tabs
    api/
      projects/route.ts      <- list/create/delete projects
      documents/route.ts      <- list a project's uploaded documents
      upload/route.ts          <- upload a document to a project
      chat/route.ts             <- send a message, get the agent's reply
      requirements/route.ts      <- full requirements list for a project (feeds the Requirements tab)
      test-cases/route.ts         <- full test case list for a project (feeds the Test Cases tab)
      bug-reports/route.ts         <- full bug report list for a project (feeds the Bugs tab)
      benchmark-rows/route.ts       <- full benchmark row list for a project (feeds the Benchmark tab)
      generated-documents/route.ts   <- list a project's generated Word documents (feeds the Documents tab)
      generated-documents/[projectId]/[fileName]/route.ts  <- download a generated .docx
      generated-documents/[projectId]/[fileName]/preview/route.ts  <- raw content for the Documents tab preview modal
      exports/[projectId]/[fileName]/route.ts  <- download a generated .xlsx
  lib/
    db.ts                      <- Prisma-backed data access + computeProjectStats
    storage.ts                 <- Cloudflare R2 (S3-compatible) file storage
    systemPrompt.ts            <- the agent's persona and working instructions
    agentTools.ts               <- the agent's custom tools (document reading, save/list, DB, browser/API tests, Jira, export, save_document)
    agent.ts                    <- runs one agent turn via the Claude Agent SDK
    tools/
      readDocument.ts            <- PDF/DOCX/XLSX/CSV/PPTX/TXT extraction
      exportArtifact.ts           <- writes requirements/test cases/bug reports/benchmark rows to .xlsx
      generateDocx.ts             <- converts the agent's Markdown (Test Plans/Reports) into a real .docx
      dbQuery.ts                  <- read-only SQL guard + execution (postgres/mysql)
      scriptRunner.ts              <- shared sandboxed child-process runner (spawn/timeout/cleanup)
      runAutomation.ts              <- Playwright script execution, built on scriptRunner
      runApiTest.ts                  <- API test execution (fetch + assert), built on scriptRunner
      jiraClient.ts                   <- Jira Cloud REST API v3 client (search/get/create/transition/comment)
```

## Known limitations

- **`xlsx` (SheetJS)** is pinned at a version with published, unpatched CVEs
  (prototype pollution, ReDoS) — acceptable since it only ever parses
  documents you provide yourself, not untrusted third-party uploads. Swap it
  before ever exposing this to uploads from anyone else.
- **`run_browser_test`/`run_api_test` are process isolation, not a security
  sandbox.** The script runs as plain Node in a separate child process with
  its own temp working directory and a hard timeout — that contains
  crashes/hangs, but a genuinely malicious script could still access the
  filesystem/network/env with this user's OS privileges, same as any local
  Node script. Acceptable because the script is authored by this agent on
  your own behalf, not by an untrusted third party.
- **`run_readonly_query`'s SELECT-only guard is a keyword/CTE check, not a
  full SQL parser.** It strips string literals before checking, and blocks
  data-modifying CTEs (`WITH x AS (DELETE ...) SELECT * FROM x`), but an
  exotic construct could theoretically slip past a regex-based guard. Point
  `DATABASE_URL` at a non-production database if that risk matters to you.
- **Jira write-confirmation is enforced by system prompt instruction, not a
  hard code-level gate.** The agent is told to only call the write tools when
  explicitly asked in the current message; this has been verified in testing
  but is a prompted behavior, not an unbypassable mechanical restriction.

## Roadmap (not built)

- Azure DevOps/GitHub Projects/Linear integration (Jira is the only PM tool
  wired up so far).
- Selenium/Cypress/Appium/Pytest execution (Playwright covers real browser
  E2E; the API test tool covers what REST Assured/Postman would).

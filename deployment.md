# Deployment Readiness Plan

This document captures the findings of a production-deployment audit of the AIMS POS & Inventory
Management System (backend/ — Express 5 + Socket.IO + Prisma/Postgres; frontend/ — React 19 +
Vite SPA; ai-service/ — FastAPI forecasting microservice) and the phased plan to close the gaps
before this system goes live.

Audit date: findings below were verified directly against the code, not assumed from older docs.
In particular, `backend/CLAUDE.md`'s note that "most endpoints are not currently JWT-protected" is
**stale** — every route in `backend/index.js` was checked directly and auth coverage is actually
solid (see Phase 1 Findings below). Don't let that old doc line drive this plan.

Each phase below follows the project's standing process: design questions get asked and answered
*before* any code is written for that phase, then the phase is implemented, tested against the
real system, and reported back — nothing here is implemented yet.

---

## Severity key

- **Blocker** — deploying without fixing this will break the app, expose it to unauthenticated
  access, or risk irreversible data loss.
- **High** — should be fixed before real users/transactions touch the system.
- **Medium/Low** — worth doing, not launch-blocking on their own.

---

## Phase 0 — Data safety net

The one phase where a mistake is irreversible (lost or corrupted production data), so it comes
first regardless of hosting choices made later.

### Findings

- **[Blocker] No versioned database migrations.** Only one migration exists:
  `backend/prisma/migrations/20260731111635_init/migration.sql`, dated 2026-07-31. Every schema
  change since (Balik Tangkilik membership/points, StockBatch/FIFO costing, ForecastSnapshot,
  reconciliation support, etc. — 16 commits touching `schema.prisma`) went through
  `prisma db push` only. Running `prisma migrate deploy` against a fresh production database today
  would **not** produce the current schema. There is no reproducible, reviewable path to stand up
  a new database.
- **[Blocker] The only DB bootstrap script is destructive and insecure.**
  `backend/prisma/seeder.js` (wired as the official `npm run seed` / `prisma db seed` command)
  unconditionally wipes nearly every core table (`deleteMany()` chain from
  `purchaseReturnItem` → ... → `user`), then recreates 5 login accounts with trivially guessable
  passwords tied 1:1 to their username/role (`admin/admin123`, `supervisor/supervisor123`,
  `cashier/cashier123`, `accounting/accounting123`, `inventory/inventory123`), plus fake demo
  products and 30 days of randomized fake transactions. Nothing gates this — there is no
  `NODE_ENV` check anywhere in the backend — so it can be run against a live production
  `DATABASE_URL` by accident with no warning.
- **[Blocker] No backup strategy exists anywhere.** No scripted or documented `pg_dump`/restore
  process, no managed-provider backup config, nothing. For a POS system whose entire business
  record (sales, inventory, reconciliations) lives in one Postgres database, this is a full-stop
  item for go-live.
- **[High] Leftover one-off scripts sit in the backend's deploy root with no safety gate:**
  `importRealData.js`, `importSalesData.js`, `cleanupDemoData.js` (store-specific, historical,
  assume a particular prior DB state — not safe to run blind), and `backfillStockBatches.js` /
  `backfillStockLedger.js` (safer — idempotent, dry-run by default with a `--commit` flag — but
  still manual migration-support tools, not something that should be discoverable as if it were a
  normal npm script). `backend/data/` (~6.6MB of source Excel files for the import scripts) also
  sits in the backend root; it's not tracked by git, but a naive "zip up backend/ and deploy"
  workflow would drag it along.

### Plan

1. Generate a real Prisma migration history that matches the current `schema.prisma`, baselined
   against the current database, so `prisma migrate deploy` can reliably rebuild the schema on a
   fresh production database.
2. Stand up automated Postgres backups (scheduled `pg_dump` or managed-provider snapshots) and
   **test the restore procedure**, not just the backup job.
3. Guard `seeder.js` and every one-off script behind an explicit environment check (e.g. refuse to
   run unless `NODE_ENV !== 'production'`, or require an explicit `--i-know-what-im-doing` flag)
   and move them out of the deploy root into something like `scripts/one-off/` with a clear
   README warning.
4. Build a separate, minimal "create the first real admin" bootstrap flow that does **not** wipe
   any table and does not use a guessable default password (e.g. prompts for or generates one).
5. Exclude `backend/data/` and the one-off scripts from whatever packaging/deploy step ships the
   backend.

---

## Phase 1 — Deployment topology & config

Nothing here works once the app is hosted anywhere other than two `localhost` ports on one
machine, so this has to land before any real hosting decision is finalized.

### Findings

- **[Blocker] Frontend hardcodes `http://localhost:5000` directly in 18 files (30 occurrences)** —
  `src/auth/AuthContext.jsx`, `ChangePasswordModal.jsx`, `useAlertNotifications.js`,
  `cashierPOS.jsx`, `AdjustStockModal.jsx`, `adminDashboard.jsx`, `AuditLogPanel.jsx`,
  `CreatePurchaseOrderModal.jsx`, `demand.jsx`, `finance.jsx`, `inventoryList.jsx`,
  `PurchaseOrdersList.jsx`, `PurchaseReturnModal.jsx`, `ReceivingReportModal.jsx`,
  `salesReport.jsx`, `StockHistoryModal.jsx`, `UserManagement.jsx`,
  `ViewReceivingReportModal.jsx`. There is no shared API-base-URL constant — every one of these
  needs editing by hand to point anywhere but localhost.
- **[Blocker] Socket.IO server CORS is hardcoded** to a single dev origin
  (`cors: { origin: 'http://localhost:5173', ... }`, `backend/index.js`). Any frontend served from
  a real domain fails its socket handshake outright.
- **[High] The REST API's CORS is wide open, not restricted** — `app.use(cors())` with no options
  reflects/allows *any* request origin. This is the opposite problem from the socket config (which
  is too narrow): one needs restricting, the other needs to become configurable — both via the
  same setting.
- **[Blocker] AI service has no auth enforced by default.** `AI_SERVICE_KEY` is optional; when
  unset, `ai-service/main.py`'s `require_key()` returns immediately and both `/api/v1/forecast`
  and `/api/v1/backtest` accept unauthenticated requests. If this service is reachable over any
  network beyond localhost without the key set (and both sides configured to use it), anyone can
  hit it.
- **[High] No env validation at process startup.** A missing/empty `JWT_SECRET` only triggers a
  `console.warn` (`models/Auth.js`) and the server still starts; a missing/wrong `DATABASE_URL`
  isn't checked until the first query runs. Failures surface as generic 500s (login literally
  500s) instead of a clear fatal error at boot.
- **[Medium] `.env.example`'s example DB credential (`postgres:admin123@...`) echoes the same
  `admin123` pattern used by the seeder's demo password** — low risk on its own (it's a
  placeholder) but worth deliberately breaking that pattern when writing real prod docs/values.

### Plan

1. Introduce a single frontend env var (e.g. `VITE_API_BASE_URL`) and replace all 30 hardcoded
   `localhost:5000` references with it.
2. Introduce a single backend env var (e.g. `FRONTEND_URL`) and use it for **both** the REST API's
   `cors()` options (restricting it, instead of the current wide-open default) and the Socket.IO
   `cors.origin` (making it configurable, instead of the current hardcoded dev origin).
3. Require `AI_SERVICE_KEY` to be set in any non-local environment (enforced by the Phase 1 env
   validation below) and firewall the AI service so only the backend can reach it — it should
   never be publicly internet-facing.
4. Add a startup check (backend and ai-service) that hard-exits with a clear error message if
   required env vars (`JWT_SECRET`, `DATABASE_URL`, `AI_SERVICE_KEY` when applicable) are missing
   or look obviously weak, instead of starting in a silently-broken or silently-insecure state.

---

## Phase 2 — Security hardening

### Findings

- **[High] No `helmet` (or equivalent) anywhere** — no security headers (CSP, X-Frame-Options,
  etc.) at all; not in `backend/package.json`'s dependencies.
- **[High] No general-purpose rate limiting.** The only throttle is
  `backend/services/loginThrottle.js` — in-memory, per-username (not per-IP), 5 failures in 15
  minutes locks that username for 15 minutes. Gaps: it resets on every process restart, won't
  coordinate across multiple backend instances if ever scaled horizontally, doesn't stop an
  attacker spraying many different usernames, and nothing else (checkout, exports, forecast, etc.)
  is rate-limited at all.
- **[High] The login page displays working dev credentials on screen, ungated.**
  `frontend/src/pages/ims/login.jsx` unconditionally renders a "Dev mode — try admin / admin123..."
  hint with no build-time flag guarding it.
- **[Good, confirmed no action needed] Password/PIN hashing is solid** — bcrypt with 10 salt
  rounds (`models/User.js`), consistently applied; hashes are never returned in API responses;
  login uses a timing-safe dummy-hash comparison for unknown usernames to prevent username
  enumeration via response timing.
- **[Medium] `npm audit --production` findings:**
  - Backend: 8 vulnerabilities (5 high, 3 moderate) — `fast-uri` (host-confusion/SSRF, transitive
    via Prisma tooling), `mysql2` (auth-plugin credential leak + DoS — transitive/unused at
    runtime since this app uses Postgres, but still worth clearing), `qs` (DoS via array-limit
    bypass), `uuid` (missing bounds check, via `exceljs`). The `fast-uri`/`qs` fixes are
    non-breaking (`npm audit fix`); the `mysql2`/`uuid` fixes require `--force` (Prisma and
    exceljs version changes — need a compatibility check first).
  - Frontend: 5 vulnerabilities (3 high, 2 moderate) — `nanoid` (infinite loop on size=0),
    `react-router`/`react-router-dom` (RSC-mode CSRF bypass), `uuid` (same as above, via
    `exceljs`). `nanoid`/`react-router` fixes are non-breaking; `uuid` needs the same `--force`
    evaluation as the backend.
  - ai-service: dependencies are exactly pinned and look current on their face; a `pip-audit` pass
    wasn't run yet and should be before shipping.

### Plan

1. Add `helmet` to the backend with sensible defaults (revisit CSP specifics once the frontend's
   hosting model is settled in Phase 4).
2. Add IP-based rate limiting (`express-rate-limit` or equivalent) globally, layered on top of the
   existing username-based login throttle rather than replacing it, with tighter limits on login
   and checkout specifically.
3. Remove the hardcoded credential hint from the login page (or gate it behind a build-time
   "demo mode" flag that defaults off).
4. Run `npm audit fix` (backend and frontend) for the non-breaking half; evaluate the Prisma and
   exceljs upgrade paths for the `--force` fixes and apply if compatible; run `pip-audit` on
   ai-service and address anything found.

---

## Phase 3 — Observability & resilience

### Findings

- **[High] No structured logging anywhere** — just scattered `console.error`/`console.log` (67
  occurrences in `index.js` alone, 19 more across models/services). No log levels, no request
  correlation IDs, nothing shipped to any aggregator.
- **[High] No crash/error monitoring** — no Sentry or equivalent dependency in either
  `backend/package.json` or `frontend/package.json`.
- **[Medium] No global `uncaughtException`/`unhandledRejection` handler** in `index.js`. Combined
  with the lack of a process manager (Phase 4), a single unhandled rejection can silently crash
  the whole backend with no alert and no auto-restart.
- **[Medium] No backend health-check endpoint at all** — ai-service already has `GET /health`; the
  backend has nothing equivalent for a load balancer, process supervisor, or uptime monitor to
  poll.
- **[Medium] No boot-time database connectivity check** — `server.listen()` succeeds and the
  process reports itself "running" even if Postgres is completely unreachable, since the
  Prisma/pg pool connects lazily. Every DB-backed route then 500s generically until someone
  investigates.
- **[Good, confirmed no action needed] AI-service unavailability is already handled gracefully** —
  `services/aiClient.js` has a 5s timeout, one retry on timeout/network/5xx, and a 3-failure
  circuit breaker (60s cooldown), falling back to a deterministic JS engine that mirrors the
  Python one. This path doesn't need rework.

### Plan

1. Add structured logging (pino or winston) on the backend, replacing `console.*` calls with
   leveled, timestamped log lines; consider the same for ai-service if not already using Python's
   `logging` module consistently.
2. Wire an error-monitoring service (Sentry or equivalent) into both backend and frontend.
3. Add `process.on('uncaughtException', ...)` / `process.on('unhandledRejection', ...)` handlers
   that log the failure clearly before exiting, so a process manager (Phase 4) can restart cleanly
   instead of the process dying silently.
4. Add `GET /api/health` on the backend that pings the database and reports service status.
5. Add a boot-time database connectivity check that fails fast with a clear fatal log line if
   Postgres isn't reachable, instead of starting in a broken state.

---

## Phase 4 — Packaging & CI

### Findings

- **[High] No containerization anywhere** — no Dockerfile, docker-compose, or any container config
  in the repo (backend/, frontend/, ai-service/, or root).
- **[High] No process manager config anywhere** — no pm2 ecosystem file, no systemd unit, nothing.
  `npm start` is just `node index.js` with no clustering and no auto-restart-on-crash; combined
  with the missing crash handlers (Phase 3), one unhandled error takes the service down until
  someone manually restarts it.
- **[Medium] The documented ai-service "production" start command uses a dev-only flag** —
  `backend/CLAUDE.md` documents `uvicorn main:app --reload --port 8000`; `--reload` auto-restarts
  on file changes and adds overhead, and no separate real production invocation (no `--reload`,
  explicit worker count) is documented anywhere.
- **[Medium] The backend never serves the frontend build** — no `express.static`/`sendFile`
  anywhere in `index.js`, confirmed by search. Frontend and backend are two separate deployables
  by design (e.g. a static host/CDN + a reverse proxy for the API), which is a valid architecture
  but is currently undocumented — and it's exactly what collides with Phase 1's hardcoded-URL and
  CORS gaps to make a split-host deployment non-functional today.
- **[Blocker for having a real deployment *process*, distinct from the app itself] No CI pipeline
  anywhere** — no `.github/workflows/`, no CI config of any kind repo-wide. Nothing runs tests or
  lint automatically on push or PR; every check today is manual.
- **[High] Test coverage is thin and one-sided.** Backend has a real `node --test` suite (7 files)
  but it's entirely forecasting/stock-math focused — zero coverage for auth, checkout, purchasing,
  or reconciliation, and nothing exercises `index.js`'s routes/middleware directly. Frontend has no
  tests and no test script at all. ai-service has decent unittest coverage already (auth, backtest,
  engine, stats) — no action needed there.
- **[Info, not a gap] `frontend/vite.config.js` sets `base: './'`** (relative asset paths), which
  is portable for static hosting — the build step itself looks mechanically production-ready; it
  just hasn't been exercised end-to-end against a non-localhost API base yet (see Phase 1).

### Plan

1. Write Dockerfiles for the backend and ai-service; decide and document the frontend's
   static-hosting story (containerized Nginx vs. a static host/CDN) once Phase 1's env-based API
   URL is in place.
2. Add a process manager / restart policy — pm2 or systemd for a VPS-style deployment, or the
   container orchestrator's own restart policy if going the Docker route.
3. Switch the ai-service's production start command off `--reload` and document the real one
   (worker count, no auto-reload) alongside the existing dev instructions.
4. Add a CI pipeline (GitHub Actions or equivalent) that runs `npm test` (backend),
   `npm run lint` (frontend), and the ai-service's `python -m unittest discover` on every push/PR,
   at minimum as a required check before merge.
5. Add basic integration/route tests for auth and checkout specifically, since those are the
   highest-value gaps in current test coverage and the parts most likely to break silently.

---

## Suggested order

Phase 0 is the most urgent regardless of everything else, since it's the only category where a
mistake is irreversible. Phases 1–4 are written in a reasonable default order (nothing works
off-localhost until Phase 1; Phase 2/3 harden what's already reachable; Phase 4 is packaging and
process discipline once the app itself is deployment-shaped) but the actual hosting target (VPS
vs. managed cloud, Docker or not, domain already chosen) may reorder or merge some of these —
that gets settled with clarifying questions before each phase starts, per the project's usual
process.

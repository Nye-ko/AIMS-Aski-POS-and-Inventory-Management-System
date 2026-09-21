# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIMS POS & Inventory Management System — a three-service application:
- **backend/** — Express 5 REST API + Socket.IO, using Prisma ORM against PostgreSQL.
- **frontend/** — React 19 + Vite SPA (Tailwind CSS v4), covering both the cashier POS screen and the admin inventory/finance dashboard.
- **ai-service/** — FastAPI (Python) microservice that produces demand/revenue forecasts from transaction history.

A stray `package.json`/`package-lock.json` also exist at the repo root (a handful of dependencies, no scripts). Nothing in the repo installs or runs from there — treat it as vestigial, not a workspace root.

## Commands

### Backend (`backend/`)
```
npm install                # install deps
npx prisma db push         # sync Prisma schema to Postgres (no migration files)
npm run dev                # start with --watch on http://localhost:5000
npm start                  # start without watch
npm run seed               # run prisma/seeder.js (prisma db seed)
```
`npm test` runs the forecast-engine tests (`node --test`, no extra dependencies); there is no other test suite yet.

### Frontend (`frontend/`)
```
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build       # production build
npm run preview     # preview the production build
npm run lint         # ESLint over the project
```
No test suite is configured.

### AI service (`ai-service/`)
```
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Run all three together (see `runner.txt`) in separate terminals: frontend (`npm run dev`), backend (`npm run dev`), ai-service (`uvicorn main:app --reload --port 8000`).

### Database setup
Requires a local PostgreSQL database named `aims-pos-ims-db`. `backend/.env` (see `backend/.env.example`) must define `DATABASE_URL` and `JWT_SECRET` (login fails without it), plus optional `PORT`, `PYTHON_AI_URL`, SMTP vars for email alerts, and `RECEIPT_PRINTER_INTERFACE`/`RECEIPT_PRINTER_TYPE` for silent receipt printing. After changing `backend/prisma/schema.prisma`, run `npx prisma db push` from `backend/` to apply it — this repo pushes schema changes directly rather than using versioned migrations for day-to-day work (one migration exists under `prisma/migrations/` from initial setup).

## Architecture

### Backend
- `backend/index.js` is a single Express app: all routes are registered directly on `app` (no router/controller layering). It also owns the HTTP server and a Socket.IO instance (attached to `app` via `app.set('io', io)`), used to broadcast `finance_updated` and `transaction_created` events to the frontend in real time.
- `backend/models/*.js` are the data-access layer — plain objects of async functions (not classes), each wrapping Prisma Client calls. `models/Product.js` is where the shared `PrismaClient` (with the `@prisma/adapter-pg` driver adapter over a `pg.Pool`) is constructed and exported; other models import `{ prisma }` from there rather than creating their own client.
- `backend/services/*.js` holds side-effecting integrations kept out of the models: `mailer.js` (nodemailer transporter, no-ops silently if SMTP env vars are missing), `lowStockAlerts.js`/`expiryAlerts.js`/`forecastAlerts.js` (build alert payloads and email them via the mailer), `receiptPrinter.js` (raw ESC/POS over TCP port 9100 for silent thermal-printer receipts, no-ops if `RECEIPT_PRINTER_INTERFACE` is unset), and the `*Excel.js` files (build `exceljs` workbooks for purchase orders/returns/receiving reports).
- `node-cron` (wired in `index.js`) fires a daily low-stock + expiry digest at `DAILY_DIGEST_CRON` (default 08:00 `Asia/Manila`); individual crossing events (a checkout dropping stock to/below `minStock`, an expiry date entering the warning window) also trigger one-off alert emails inline in the relevant route handlers.
- Auth (`models/Auth.js`): `AuthModel.login` checks bcrypt-hashed passwords and signs a JWT (`{ id, username, role }`, 12h expiry) for `POST /api/auth/login`. `authenticateToken` middleware verifies `Authorization: Bearer <token>` and is applied to `GET /api/auth/me`, but per the comments in `Auth.js` it is not yet applied across the rest of the routes — most endpoints are not currently JWT-protected server-side even though the frontend gates navigation with it.
- `backend/config/db.js` sets up a Mongoose/MongoDB connection but is not imported anywhere — the active database layer is Postgres via Prisma. Treat this file as vestigial rather than part of the current architecture.
- `backend/prisma/schema.prisma` defines the full relational schema: `User` (role-based: CASHIER/SUPERVISOR/ADMIN), `Product`/`Supplier`, `Transaction`/`TransactionItem` (POS sales), `Reconciliation` (end-of-day cash count with denomination breakdown), and purchasing docs (`PurchaseOrder`, `ReceivingReport`, `PurchaseReturn` + their item tables). Money fields use `Decimal(10,2)`; `BigInt.prototype.toJSON` is monkey-patched at the top of `index.js` so BigInt values (e.g. Postgres counts) serialize correctly in JSON responses.
- Demand forecasting (`models/DemandForecast.js`) aggregates sales per product per store-local day in SQL (`STORE_TIMEZONE`, default `Asia/Manila`; `FORECAST_HISTORY_DAYS`, default 180), POSTs that to the AI microservice (`PYTHON_AI_URL`, default `http://localhost:8000/api/v1/forecast`, 15s timeout) and falls back to `services/forecastEngine.js` if it is unreachable. The fallback is a deterministic JS twin of `ai-service/forecast_engine.py` (never random) and marks the response `meta.source: "fallback"`. Keep the two engines identical: both are checked against `ai-service/tests/fixtures`; after changing either, run `python tests/make_fixture.py` from `ai-service/` and review the golden diff, then `npm test` in `backend/`.
- Forecast accuracy: `ForecastSnapshot`/`ForecastSnapshotItem` store each day's forecast (saved by a nightly cron `FORECAST_SNAPSHOT_CRON`, default `5 0 * * *` store time, and by the first `/api/forecast` call of the day; only today's forecast may be saved). `GET /api/forecast/accuracy` grades saved forecasts against real sales (`services/forecastAccuracy.js`, live) and asks the AI service to replay its engine over history (`ai-service/backtest.py`, `POST /api/v1/backtest`). Both use the same metrics (WAPE, bias) and compare against a "previous period" baseline; keep the two graders identical (round half up, plain float summation).
- Route handlers consistently: wrap logic in try/catch, `console.error` on failure, and return `res.status(500).json({ error: '...' })`.

### Frontend
- Routing is centralized in `frontend/src/App.jsx` using `react-router-dom`. `/pos` (cashier-facing) and `/` (login) render standalone; everything else (`/adminDashboard`, `/inventoryList`, `/pages/ims/demand`, `/pages/ims/finance`) is nested under an `AppLayout` route element that renders the shared `Sidebar` plus an `<Outlet />`. Every route except `/` is wrapped in `<RequireAuth>` (`src/auth/RequireAuth.jsx`), which redirects to `/` when `AuthContext` has no session.
- `src/auth/AuthContext.jsx` holds the logged-in session (`{ token, id, username, role }`) in `sessionStorage` under key `aims.auth` and exposes `login`/`logout`/`isAuthenticated`. Login itself calls the backend directly with `fetch`.
- There is no shared API-base-URL constant or `.env` value on the frontend: `http://localhost:5000` (or `/api` suffixed) is hardcoded independently in each page/component that calls the backend (`AuthContext.jsx`, `cashierPOS.jsx`, the `pages/ims/*` screens, `useAlertNotifications.js`, etc.) — when changing the backend URL/port, all of these need updating individually.
- Pages live under `src/pages/`: `src/pages/ims/` holds the admin/IMS screens (dashboard, inventory list, demand, finance, purchasing modals, notifications panel, sidebar), while `cashierPOS.jsx` at the top level is the cashier-facing POS screen.
- Socket.IO client wiring and CSV export helpers (`src/utils/exportCsv.js`) are the other cross-cutting frontend concerns; charts are built with `recharts`.
- Styling is Tailwind CSS v4 (via `@tailwindcss/vite`), with some inline `<style>` blocks for custom fonts/scrollbars in `App.jsx`.

### AI service
- `ai-service/main.py` is a thin FastAPI layer (Pydantic validation, `/health`); all forecasting lives in `ai-service/forecast_engine.py` as pure, deterministic, stdlib-only functions (no clock or randomness: "today" comes in as `asOf`). `POST /api/v1/forecast` takes products, per-day per-SKU sales and per-day store totals, and returns KPIs, a revenue trajectory, category breakdown, per-SKU demand/reorder/expiry status with a data-confidence level, and a `meta` block (source, engine version, days of history, warnings). The method is a zero-filled 28-day demand rate, not a trained model. Tests: `python -m unittest discover -s tests` from `ai-service/`.

## Code style

- Backend is CommonJS (`require`/`module.exports`); frontend is ES modules (`import`/`export`, `"type": "module"`).
- Models export plain objects of arrow-function methods (e.g. `const ProductModel = { findAll: async () => {...} }`), not classes. Services (`backend/services/`) follow the same plain-function-export pattern for side effects like email/printing/Excel generation.
- Prisma is always accessed through the shared client exported from `models/Product.js` — don't instantiate a second `PrismaClient`.
- IDs and quantities coming from request bodies are explicitly coerced (`parseInt`, `Number`, `parseFloat`) before use in Prisma calls, since Express doesn't validate types.
- Route handlers and model methods that hit the network/DB are `async`/`await` with try/catch at the call site, not centralized error middleware.
- Integrations that depend on optional environment config (mailer, receipt printer) check an `isConfigured()`-style guard and no-op/log instead of throwing when unconfigured — preserve this "off by default, fails soft" behavior rather than making them hard requirements.

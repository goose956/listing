# Listings Assistant — Progress & Changes

This document records the state of the project, what was already built, and the fixes/improvements made in this session.

## Project Status

The app is a **Vinted-first AI resale inventory assistant** — a full-stack web app (React + TypeScript frontend, Express backend, Supabase for database/auth/storage, OpenAI for AI features).

**Phase 1 (complete):** Auth, database, add items, upload photos, inventory dashboard.
**Phase 2 (complete):** AI image analysis, AI listing generation, Vinted listing queue, image enhancement, storage management, sales tracking.
**Phase 3 (future):** QR/barcode codes, profit analytics, eBay integration, email monitoring, marketplace integrations.

---

## What Was Already In Place

The project had a strong foundation before this session:

- **Supabase schema** (`supabase/migrations/001_initial_schema.sql`):
  - `profiles`, `items`, `item_images`, `listing_queue` tables
  - `item_id_seq` sequence + `generate_item_number()` → auto `V-000001` numbering
  - `items_with_profit` view, `get_dashboard_stats()` RPC
  - Row-level security policies, storage bucket + policies
- **Express server** (`server/`):
  - `/api/health` — health check
  - `/api/ai/analyse` — OpenAI vision analysis of product photos
  - `/api/ai/listing` — Vinted listing generation
  - `/api/images/enhance` — truthful ecommerce image enhancement (brightness/contrast only)
  - `/api/images/prepare` — resize/compress for upload
- **React client** (`client/`):
  - Auth (Supabase), Dashboard, Inventory, Add Item, Item Detail, Queue, Storage, Login pages
  - Responsive mobile/desktop layout with bottom nav on mobile, sidebar on desktop
  - AI analysis + listing generation wired to the server
  - Image enhancement + camera capture on mobile

---

## Issues Found & Fixed This Session

### 1. Build was broken (TypeScript error)
- **File:** `client/src/pages/AddItemPage.tsx`
- **Problem:** `applyAnalysis` was declared but never used → `tsc` failed, so the app couldn't build.
- **Fix:** Refactored the AI flow so analysis now fills the form **in place** on the Add Item page. The user reviews/edits every AI suggestion before saving (matches the spec: "All AI suggestions must be editable by the user"). Also added draft-item cleanup on reset so orphaned draft items don't accumulate.

### 2. Tailwind CSS v4 plugin missing
- **File:** `client/vite.config.ts`
- **Problem:** `index.css` uses Tailwind v4's `@import "tailwindcss"` syntax, but the `@tailwindcss/vite` plugin was not registered. The app would render with **no styling**.
- **Fix:** Added the `tailwindcss()` plugin. Build now produces a real stylesheet (32.68 kB CSS).

### 3. No dev proxy / hardcoded API URL
- **Files:** `client/vite.config.ts`, `client/src/lib/api.ts`
- **Problem:** API base was hardcoded to `http://localhost:3001`, causing CORS issues in dev.
- **Fix:** Added a Vite dev proxy (`/api` → `http://localhost:3001`). API base now defaults to empty (same-origin `/api`) and uses `VITE_API_URL` only when set (production).

### 4. Server couldn't start (Express 5 wildcard)
- **File:** `server/src/index.ts`
- **Problem:** Used `app.get('*', ...)` which is invalid in Express 5 / path-to-regexp v8 → server crashed on startup.
- **Fix:** Changed to `app.get('/*splat', ...)` (named wildcard). Also added a guard so unknown `/api/*` paths return a JSON 404 instead of `index.html`.

### 5. Missing config & docs (not GitHub-ready)
- **Added:**
  - Root `.gitignore` (node_modules, dist, .env, editor files, etc.)
  - `client/.env.example` (Supabase URL/key + optional API URL)
  - Root `README.md` (features, tech stack, setup, deployment, roadmap)
  - This `PROGRESS.md`

---

## New Features Added This Session

### 6. In-app queue reminders (spec: "Send reminders")
- **Files:** `client/src/lib/items.ts`, `client/src/components/Layout.tsx`
- Added `fetchDueQueueCount()` which counts queue entries due now.
- The Layout now polls every 60 seconds and shows an amber **reminder banner** ("N items due to list now → Open queue") whenever something is due. This is the in-app reminder mechanism (no email/push yet — that's a future enhancement).

### 7. Dashboard search (spec: "Include search")
- **Files:** `client/src/pages/DashboardPage.tsx`, `client/src/pages/InventoryPage.tsx`
- Added a search bar on the Dashboard that navigates to Inventory with the query pre-filled.
- Added quick-filter links (Ready to list / New / Listed / Sold) on the Dashboard.
- Inventory page now reads `?q=` and `?status=` URL params so dashboard links work directly.

### 8. Single-dyno deployment (Railway-friendly)
- **File:** `server/src/index.ts`
- The server now serves the built client (`client/dist`) alongside the API when present.
- SPA fallback returns `index.html` for client routes; unknown `/api/*` paths get a JSON 404.

---

## Verification

All checks pass:

- ✅ `npm run build --prefix client` — TypeScript + Vite production build
- ✅ `npm run build --prefix server` — TypeScript build
- ✅ `npm run lint --prefix client` — oxlint (0 errors)
- ✅ `npm run start --prefix server` — server starts, serves client + API on the same port

## How to Run

```bash
# Install dependencies
npm install

# Run dev (client + server together)
npm run dev
# Client: http://localhost:5173 · Server: http://localhost:3001

# Production build + serve
npm run build
npm start
```

## Next Steps / Phase 3 Ideas

- QR/barcode codes for storage tracking
- Profit analytics and reports
- eBay API integration
- Email / push notifications for queue reminders
- Code splitting to reduce bundle size (~527 kB JS)

---

## Session 2 — Settings Page, GitHub Push & Railway

### 9. Settings page (manage API keys in-app)
- **Files:** `supabase/migrations/004_user_settings.sql`, `server/src/lib/supabaseAdmin.ts`, `server/src/routes/ai.ts`, `client/src/lib/settings.ts`, `client/src/pages/SettingsPage.tsx`, `client/src/App.tsx`, `client/src/components/Layout.tsx`
- Added a `user_settings` table (RLS-protected, safe view that never exposes the API key).
- Added a **Settings page** in the app where you can add/remove your **OpenAI API key** and set a **Vinted username**.
- The server reads your stored key via the Supabase service role (in `server/.env`) and uses it for AI analysis/listing — with a fallback to a global `OPENAI_API_KEY`.
- Added a **Settings** item to the nav (mobile bottom bar + desktop sidebar).
- Added `server/src/lib/supabaseAdmin.ts` for server-only service-role access.

### 10. GitHub + Railway deployment
- **Pushed to GitHub:** https://github.com/goose956/listing (branch `main`).
- **Added `railway.json`** — Railway config: builds the client + server, serves both from a single service, health check at `/api/health`.
- Verified `.env` files (with secrets) are **excluded** from the repo via `.gitignore`.
- Cleaned up unused Vite template files (`App.css`, `assets/`).

### 11. Railway deployment — LIVE ✅
- Fixed Railway build (install client+server deps incl. dev, pin Node 22 via `nixpacks.toml` + `engines`).
- Fixed runtime port issue (removed custom `PORT` variable — Railway injects its own).
- Fixed SPA fallback (middleware-based `app.use` instead of `app.get('/*splat')`) so client-side routes like `/login` serve the React app.
- Added `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` to Railway for the frontend.
- **App is live on Railway** — full stack (frontend + API) from a single service.

### Remaining to do
- Run `004_user_settings.sql` in Supabase SQL Editor (creates the settings table) — needed for the Settings page.
- Add an OpenAI API key in the app's Settings page (~2 min) to enable AI photo analysis.
- The app is at a fully usable state: inventory, queue, storage, sales tracking all working on Railway.

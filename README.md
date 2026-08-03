# Listings Assistant

A Vinted-first AI resale inventory assistant for managing large second-hand resale operations. Built for a real workflow: items are purchased at boot sales, photographed on a phone, processed on desktop, listed, stored, sold, and tracked.

> **Note on Vinted automation:** Vinted has no official public API. This app provides a **semi-automated** workflow — it prepares listings, schedules them, and gives you copy-paste content + reminders to complete the final posting manually on Vinted. It never logs into or posts to Vinted automatically.

## Features

- **Inventory management** — unique item numbers (`V-000001`), photos, category, brand, size, colour, condition, pricing, storage location, and status (new → ready for listing → listed → sold → archived).
- **Mobile item capture** — responsive "Add Item" screen with camera capture, image enhancement, and AI analysis that suggests brand, type, colour, size, condition, and resale price. All AI suggestions are editable.
- **AI listing assistant** — generates a search-friendly Vinted title, honest natural description, suggested price, and tags from photos + your edits.
- **Listing queue** — schedule items by day/time, see what's due now, copy title/description, open Vinted manually, and mark as listed.
- **Image enhancement** — truthful ecommerce presentation only (brightness/contrast/sharpening). Never removes damage, changes colours, or makes used items look new.
- **Storage management** — track container / shelf / box / notes so thousands of items stay findable.
- **Sales tracking** — record sale price and date, auto-calculate profit.
- **Dashboard** — total items, ready to list, listed, sold, total profit, average sale price, inventory value, and upcoming queue.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router |
| Backend | Node.js / Express (TypeScript) |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Storage | Supabase Storage (product images) |
| AI | OpenAI vision (image analysis + listing generation) |
| Image processing | Sharp (enhancement, resize) |

## Project Structure

```
.
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/     # UI primitives, Layout, ItemCard
│   │   ├── context/        # AuthContext (Supabase auth)
│   │   ├── lib/            # supabase client, API calls, items data layer, format helpers
│   │   ├── pages/          # Dashboard, Inventory, AddItem, ItemDetail, Queue, Storage, Login
│   │   └── types/          # Shared TypeScript types
│   └── .env.example
├── server/                 # Express API (TypeScript)
│   ├── src/
│   │   ├── routes/         # health, ai (analyse/listing), images (enhance/prepare)
│   │   └── services/       # AI prompt builders
│   └── .env.example
└── supabase/
    └── migrations/         # SQL schema (tables, RLS, functions, storage bucket)
```

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (free tier is fine)
- An OpenAI API key (for AI features)

### 1. Database setup

1. Create a Supabase project.
2. Open the **SQL Editor** and run the contents of `supabase/migrations/001_initial_schema.sql`.
3. This creates the tables, row-level security, the `item_id_seq` sequence, the `get_dashboard_stats` function, and the `item-images` storage bucket with policies.

### 2. Configure environment

**Client** — copy `client/.env.example` to `client/.env`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Server** — copy `server/.env.example` to `server/.env`:

```bash
PORT=3001
CORS_ORIGIN=http://localhost:5173
OPENAI_API_KEY=sk-your-key-here
OPENAI_VISION_MODEL=gpt-4o-mini
```

### 3. Install & run

```bash
# Install all workspace dependencies
npm install

# Run client + server together (dev)
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001 (health check at `/api/health`)

In dev, Vite proxies `/api` requests to the Express server, so no CORS issues.

### 4. Build for production

```bash
npm run build
npm start   # serves the API (see below for serving the client)
```

## Deployment

### Railway (recommended)

The server can serve both the API and the built client from a single dyno:

1. Build the client: `npm run build` (outputs to `client/dist`).
2. Deploy the `server/` directory to Railway.
3. Set env vars: `PORT`, `CORS_ORIGIN`, `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`.
4. The client is served from `client/dist` if present (see `server/src/index.ts`).

Alternatively, host the client separately (e.g. Vercel/Netlify) and set `VITE_API_URL` to the Railway API URL.

### Supabase

- Database, auth, and storage all live in Supabase — no extra hosting needed for those.
- Run the migration SQL in the Supabase SQL Editor.

## Roadmap

**Phase 1 (done):** Auth, database, add items, upload photos, inventory dashboard.

**Phase 2 (done):** AI image analysis, AI listing generation, Vinted listing queue, image enhancement, storage management, sales tracking.

**Phase 3 (future):** QR/barcode codes, profit analytics, eBay integration, email monitoring, marketplace integrations.

## License

MIT
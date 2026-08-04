# Chrome Extension — Build Plan

A Manifest V3 Chrome extension that connects to the Listings Assistant backend and
fills Vinted's listing form automatically. Users only need to upload photos and click Publish.

---

## Workspace context

- **Backend:** Node.js / Express (TypeScript) — `server/src/`
- **Frontend:** React 19 + Vite — `client/src/`
- **Database / Auth:** Supabase (PostgreSQL + RLS + Supabase Auth)
- **Deployment:** Railway (single dyno, server serves client/dist)
- **Existing routes:** `/api/health`, `/api/ai/*`, `/api/images/*`, `/api/email/*`
- **Key types:** `Item`, `ListingQueueEntry`, `ItemImage` in `client/src/types/index.ts`

The extension authenticates as the user via their Supabase JWT — the same token the
web app uses. All data is already RLS-scoped per user.

---

## Directory structure to create

```
chrome-extension/
  manifest.json              # MV3 manifest
  package.json
  tsconfig.json
  vite.config.ts             # Multi-entry Vite build
  src/
    popup/
      popup.html             # Extension popup shell
      popup.ts               # Main popup logic (queue list + login)
      popup.css              # Styles (Tailwind or plain CSS)
    content/
      content.ts             # Injected into Vinted sell page — fills form
      sidebar.ts             # Floating sidebar injected into the page
      sidebar.css
    background/
      service-worker.ts      # Badge count, message routing
    shared/
      api.ts                 # Authenticated calls to Listings Assistant server
      auth.ts                # JWT storage / retrieval via chrome.storage.local
      supabase.ts            # Supabase client (auth only, no direct DB access)
      types.ts               # Shared types (mirrors client/src/types/index.ts)
  icons/
    16.png
    48.png
    128.png
  dist/                      # Build output (gitignored)
```

---

## Server changes required

### 1. New route: `server/src/routes/queue.ts` (extension queue endpoint)

`GET /api/extension/queue`

- Authenticates via `Authorization: Bearer <supabase-jwt>` header
- Verifies the JWT using `getSupabaseAdmin().auth.getUser(token)`
- Returns all `scheduled` / `due` queue entries for the user, joined with item
  details and image URLs
- Response shape:
```json
{
  "items": [
    {
      "queue_id": "uuid",
      "scheduled_at": "ISO string",
      "item_id": "uuid",
      "item_number": "V-000012",
      "title": "Nike Air Max — Black size 9",
      "description": "Full listing description...",
      "price": 45.00,
      "brand": "Nike",
      "size": "9",
      "colour": "Black",
      "condition": "good",
      "category": "Trainers",
      "tags": ["nike", "trainers", "black"],
      "images": [
        { "url": "https://...", "is_primary": true }
      ]
    }
  ]
}
```

`POST /api/extension/queue/:queueId/complete`

- Marks queue entry as completed, sets item status to `listed`, records `listed_date`
- Same auth pattern as above

### 2. Register in `server/src/index.ts`

```ts
import { extensionRouter } from './routes/extension.js';
app.use('/api/extension', extensionRouter);
```

### 3. CORS update in `server/src/index.ts`

Add `chrome-extension://*` as an allowed CORS origin so the extension popup and
service worker can call the API. Because extension IDs vary per install, use a
regex matcher:

```ts
origin: (origin, callback) => {
  const allowed = [
    /^chrome-extension:\/\//,
    /^http:\/\/localhost/,
    // production origins here
  ];
  if (!origin || allowed.some(r => r.test(origin))) callback(null, true);
  else callback(new Error('Not allowed by CORS'));
}
```

---

## Extension phases

### Phase 1 — Scaffold + server endpoint (start here)

**Goal:** Extension loads, shows "not logged in", server endpoint works.

Tasks:
- [ ] Create `chrome-extension/` directory with `package.json`, `tsconfig.json`,
      `vite.config.ts`, `manifest.json`
- [ ] Vite config with two entry points: `popup/popup.ts` and
      `background/service-worker.ts` (content script built separately)
- [ ] Minimal `popup.html` + `popup.ts` — just renders "Listings Assistant" heading
- [ ] `manifest.json` — MV3, host permission for `https://www.vinted.co.uk/*` and
      `https://www.vinted.com/*`, plus the Railway server URL
- [ ] Create `server/src/routes/extension.ts` with `GET /queue` (stubbed, returns [])
- [ ] Register route in `server/src/index.ts`
- [ ] Update CORS to allow extension origins

### Phase 2 — Authentication

**Goal:** User can log in via the popup; JWT is stored and reused.

Tasks:
- [ ] Add Supabase browser client to extension (`shared/supabase.ts`) — anon key only,
      used only for `signInWithPassword`
- [ ] `shared/auth.ts` — helpers: `saveToken(jwt)`, `getToken()`, `clearToken()`
      using `chrome.storage.local`
- [ ] `popup.ts` — show login form (email + password) when not authenticated;
      on success call `supabase.auth.signInWithPassword`, save JWT, show queue view
- [ ] `shared/api.ts` — `fetchQueue()` that calls `GET /api/extension/queue` with
      `Authorization: Bearer <jwt>`
- [ ] Show logout button; on logout clear token and return to login screen

### Phase 3 — Queue UI in popup

**Goal:** Popup shows pending queue items clearly, user can click to trigger form fill.

Tasks:
- [ ] `popup.ts` — fetch and render queue items on load
- [ ] Each item card shows: item number, title, price, scheduled time, primary image
      thumbnail
- [ ] "Fill Vinted form" button on each card — sends a message to the content script
      via `chrome.tabs.sendMessage` with the item payload
- [ ] Badge on extension icon shows count of due items (service worker polls every
      60s using `chrome.alarms`)
- [ ] Empty state: "No items due. Go to your queue to schedule items."
- [ ] Error state: "Could not connect to server" with retry button

### Phase 4 — Content script & form filling

**Goal:** Click "Fill Vinted form" → all text fields on Vinted's sell page populate.

**This is the most complex phase.** Vinted's sell form is a React app, so standard
`element.value = "..."` won't trigger React's state. You must use the
`nativeInputValueSetter` trick:

```ts
function setReactInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )!.set!;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
```

For `<textarea>` use `HTMLTextAreaElement.prototype.value`.

Tasks:
- [ ] Create `content/content.ts` — listen for messages from popup via
      `chrome.runtime.onMessage`
- [ ] On receiving an item payload, call `fillVintedForm(item)`
- [ ] `fillVintedForm` implementation:
  - Wait for form to be ready (MutationObserver or polling with timeout)
  - Fill title input (selector TBD — inspect Vinted's actual page)
  - Fill description textarea
  - Fill price input
  - Fill brand input (may be a text field or autocomplete)
  - **Show a floating sidebar** (injected HTML) displaying item images for manual upload
- [ ] Inject `content/sidebar.ts` — a small fixed-position panel on the right side
      of the screen showing:
  - Item number + title
  - All item images (clickable to open full size for drag-and-drop to Vinted's uploader)
  - "Mark as Listed" button (calls `POST /api/extension/queue/:id/complete`)
  - Dismiss button
- [ ] Register content script in `manifest.json` for Vinted sell page URLs

**Selectors research needed:** Before implementing, inspect the live Vinted
`/items/new` page to find the actual input selectors. They may use `data-testid`,
`name`, `placeholder`, or `aria-label` attributes. Document them in a comment at
the top of `content.ts`.

### Phase 5 — Polish & "Mark as Listed"

**Goal:** Completing the loop — once user publishes on Vinted, mark item as done.

Tasks:
- [ ] "Mark as listed" button in sidebar calls `POST /api/extension/queue/:id/complete`
- [ ] On success: sidebar shows green confirmation, item disappears from popup queue
      on next load
- [ ] Handle token expiry: if API returns 401, prompt user to log in again
- [ ] Add Vinted UK + IE + other country URL patterns to manifest host_permissions
      (Vinted operates on multiple TLDs: `.co.uk`, `.fr`, `.de`, `.ie`, etc.)

---

## Manifest V3 skeleton

```json
{
  "manifest_version": 3,
  "name": "Listings Assistant for Vinted",
  "version": "1.0.0",
  "description": "Fill your Vinted listing form from your Listings Assistant queue",
  "permissions": ["storage", "alarms", "activeTab", "tabs"],
  "host_permissions": [
    "https://www.vinted.co.uk/*",
    "https://www.vinted.com/*",
    "https://www.vinted.fr/*",
    "https://www.vinted.de/*",
    "https://your-railway-app.up.railway.app/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png"
    }
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.vinted.co.uk/items/new*",
        "https://www.vinted.com/items/new*",
        "https://www.vinted.fr/items/new*"
      ],
      "js": ["content/content.js"],
      "css": ["content/sidebar.css"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## Environment variables

The extension needs two compile-time constants (baked in at build time by Vite):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (safe to embed in extension) |
| `VITE_API_URL` | Your Railway server URL (e.g. `https://your-app.up.railway.app`) |

Create `chrome-extension/.env` (gitignored).

---

## Build & load locally

```bash
cd chrome-extension
npm install
npm run build        # outputs to chrome-extension/dist/

# In Chrome:
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select chrome-extension/dist/
```

After any code change: `npm run build` then click the refresh icon on the extension
card in `chrome://extensions`.

---

## Key technical notes for other models

1. **React input trick** — Vinted's form is React-based. Standard `.value =` won't
   work. Use the `nativeInputValueSetter` pattern (see Phase 4 above).

2. **Content script → popup communication** — The popup sends a message to the
   active tab's content script. The content script cannot initiate messages to the
   popup (it may not be open). Use `chrome.runtime.onMessage` in the content script
   and `chrome.tabs.sendMessage` from the popup.

3. **Service worker limitations** — MV3 service workers are not persistent. Don't
   store state in module-level variables; use `chrome.storage.local` for everything
   that needs to survive.

4. **CORS** — Requests from the extension popup/service worker include an
   `Origin: chrome-extension://[id]` header. The server must allow this. See the
   CORS section above.

5. **Supabase JWT expiry** — Supabase JWTs expire after 1 hour by default. The
   extension should detect 401 responses and prompt re-login. For longer sessions,
   store the refresh token too and call `supabase.auth.refreshSession()`.

6. **Selector fragility** — Vinted's form selectors will change over time. Keep all
   selectors in a single `SELECTORS` constant object at the top of `content.ts` so
   they're easy to update.

---

## Suggested build order for parallel work

| Track | Work |
|---|---|
| **Server** | Phase 1 server tasks: `extension.ts` route + CORS update |
| **Extension** | Phase 1 + 2: scaffold, build setup, auth flow |
| **Extension** | Phase 3: popup queue UI (can use mock data while server track finishes) |
| **Extension** | Phase 4: content script (needs live Vinted page to inspect selectors) |

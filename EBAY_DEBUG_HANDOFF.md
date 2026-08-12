# eBay Listing Integration — Debug Handoff (2026-08-10)

## Stack
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 — `client/`
- **Backend**: Node.js/Express TypeScript — `server/`
- **Database**: Supabase PostgreSQL + RLS + Auth
- **Deploy**: Railway — `https://listing-production-a903.up.railway.app` (~2–3 min build)
- **eBay**: Sandbox, marketplace `EBAY_GB`, user `rthomasgoldie@gmail.com`

## Current Error (as of 21:36 GMT+1, 2026-08-10)

**eBay error 25002** — missing required item specific `Type`:

```json
{
  "errorId": 25002,
  "message": "The item specific Type is missing. Add Type to this listing, enter a valid value, and then try again.",
  "parameters": [{ "name": "2", "value": "Type" }]
}
```

This fires during `publishOffer` (`POST /sell/inventory/v1/offer/{offerId}/publish`).  
eBay requires category-specific item specifics. For clothing categories (e.g. `53159` = Women's Tops & Shirts),  
eBay mandates a `"Type"` aspect (e.g. `"T-Shirt"`, `"Blouse"`, `"Top"`).

### Root cause in code

`server/src/routes/ebay.ts` → `buildAspects()` (line ~799):

```ts
function buildAspects(item: Record<string, any>): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  if (item.brand)  aspects['Brand']  = [item.brand];
  if (item.size)   aspects['Size']   = [item.size];
  if (item.colour) aspects['Colour'] = [item.colour];
  return aspects;  // ← "Type" is never populated
}
```

The `item` object has a `product_type` field (see `client/src/types/index.ts` line 27):  
```ts
product_type: string | null;
```
This value is populated by the AI analysis pipeline, but it is **never included in `aspects`**.

### Fix required

Add `Type` (and optionally `Department`/`Gender`) to `buildAspects`:

```ts
function buildAspects(item: Record<string, any>): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  if (item.brand)        aspects['Brand']      = [item.brand];
  if (item.size)         aspects['Size']       = [item.size];
  if (item.colour)       aspects['Colour']     = [item.colour];
  if (item.product_type) aspects['Type']       = [item.product_type];
  return aspects;
}
```

If `product_type` is null for older items you may also need a fallback derived from the eBay category label the user selected (passed as `ebayCategoryId` in `req.body`).

---

## Full History of Errors Fixed Before This

### 1. Error 25059 — Invalid condition `LIKE_NEW` / condition ID 2750
- **Cause**: `LIKE_NEW` enum maps to condition ID 2750 in eBay's clothing taxonomy, which those categories reject.
- **Fix**: Removed `1500` from `CONDITION_ID_TO_ENUM`. Added `getValidConditionIds()` (metadata API) to select the best valid condition ID. Retry chain: `[conditionId, 3000, 1000]` (i.e. USED_EXCELLENT, NEW).

### 2. Error 25007 — Fulfillment policy inaccessible
- **Cause**: eBay sandbox periodically resets Business Policy Management opt-in, making existing fulfillment policies return 403/404.
- **Fix**: Added `POST /sell/account/v1/program/opt_in { programType: 'SELLING_POLICY_MANAGEMENT' }` at the start of every listing attempt. If it returns 409 ("already enrolled"), the error is silently ignored.
- **Also**: `ensureValidFulfillmentPolicy()` now verifies the stored policy has shipping services and repairs/recreates it if not.

### 3. Error 25005 — Non-leaf category ID
- **Cause (first)**: `getCategoryId()` mapping returned top-level parent IDs (e.g. `15724` = "Women's Clothing"). eBay only accepts leaf categories.
- **Fix**: Added 45 verified leaf category IDs in `client/src/lib/ebay.ts` → `EBAY_GB_CATEGORIES`. Added a category `<select>` dropdown to `ItemDetailPage.tsx`. IDs verified via `GET /commerce/taxonomy/v1/category_tree/{id}/get_category_subtree`.
- **Cause (second)**: Default state for `ebayCategoryId` in `ItemDetailPage.tsx` was still `'15724'` (non-leaf parent).
- **Fix**: Changed default to `EBAY_GB_CATEGORIES[0].id` (`'53159'`). Required `useState<string>(...)` to avoid TypeScript literal-type narrowing error (build failure on Railway).
- **Cause (third — stale offer)**: Existing eBay offer had old non-leaf `categoryId` baked in. eBay ignores `categoryId` changes on `PUT`.
- **Fix**: On offer-already-exists error, `GET` the existing offer, compare `categoryId`. If different: `DELETE` it, then `POST` a fresh offer.

### 4. Build failure — `useState` literal type
- **Cause**: `EBAY_GB_CATEGORIES as const` made `EBAY_GB_CATEGORIES[0].id` type `"53159"` (literal), so `useState(EBAY_GB_CATEGORIES[0].id)` inferred state as `"53159"`, breaking `setEbayCategoryId(e.target.value)`.
- **Fix**: `useState<string>(EBAY_GB_CATEGORIES[0].id)`.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `server/src/routes/ebay.ts` | All eBay listing logic. `buildAspects()` at ~line 799. `ensureValidFulfillmentPolicy()` above the `/list` route. |
| `server/src/lib/ebay.ts` | OAuth helpers, `ebayApi` client, `getValidConditionIds()`, `CONDITION_ID_TO_ENUM`, `EBAY_CONFIG`. |
| `client/src/pages/ItemDetailPage.tsx` | Category dropdown, price inputs, publish button. `ebayCategoryId` state at ~line 96. |
| `client/src/lib/ebay.ts` | `EBAY_GB_CATEGORIES` (45 leaf IDs), `createEbayListing()`. |
| `client/src/types/index.ts` | `Item` type — includes `product_type: string | null` at line 27. |

## Current Railway Environment Variables
```
EBAY_CLIENT_ID=(set in Railway)
EBAY_CLIENT_SECRET=(set in Railway)
EBAY_DEV_ID=(set)
EBAY_REDIRECT_URI=https://auth.ebay.com/oauth2/ThirdPartyAuthSucessFailure
EBAY_SANDBOX=true
SUPABASE_URL=https://xbsuxlkpqblljnljlcdj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(set)
VITE_SUPABASE_URL=(set)
VITE_SUPABASE_ANON_KEY=(set)
```

## eBay Sandbox State (as of 21:50 GMT+1, 2026-08-10)
- Business Policies: **opted in** (409 on re-opt means already enrolled — that's correct)
- Fulfillment policies: 6 exist; stored `fulfillment_policy_id` = `6242950000` ("Default Shipping", `UK_RoyalMailSecondClassStandard`)
- Inventory items on eBay: **0** (sandbox is clean, no stale offers)
- Latest deployed commit: `56db2db`

## What To Do Next

1. In `server/src/routes/ebay.ts`, update `buildAspects()` to include `Type` from `item.product_type`.
2. If `product_type` can be null for items, derive a fallback from the selected category label (the `ebayCategoryId` from `req.body` maps back to a label in `EBAY_GB_CATEGORIES` on the client, but the server doesn't have that map — consider adding a server-side `CATEGORY_LABEL_MAP` or passing the label in the request).
3. Commit and push — Railway will deploy automatically.

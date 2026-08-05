# Listings Assistant — Version 2 Roadmap

## Current State (v1 Complete)
- [x] Inventory management (add items, photos, storage locations)
- [x] AI listing generation via GPT-4o vision
- [x] Queue / scheduling system
- [x] Chrome extension — Vinted form-filling sidebar
- [x] Email listing feature (Resend)
- [x] Multi-user data isolation (Supabase RLS)
- [x] Railway deployment (single dyno, serves frontend + API)
- [x] Manual posting improvements (download photos, copy all, mark as listed)

---

## Phase 1 — Commercial Foundation
> Goal: Make the app ready to charge real users money

- [x] **Admin panel**
  - User list with email, joined date, item count, AI usage
  - Delete user (with cascade — removes all their data)
  - Config tab showing which API keys are set (never exposes values)
  - Platform-wide stats overview
  - Admin access gated by `ADMIN_EMAIL` env var

- [x] **Use your own OpenAI key**
  - Server already uses `OPENAI_API_KEY` env var; user key is optional override
  - Set `OPENAI_API_KEY` in Railway Variables to remove the requirement from users

- [x] **Onboarding flow**
  - 3-step checklist on dashboard for new users (add item → generate listing → schedule/post)
  - Steps auto-complete based on real user data
  - Disappears once user has items in inventory

- [ ] **Stripe subscription integration**
  - Add Stripe Checkout + billing portal
  - Gate features by plan (e.g. AI credits, number of items)
  - Store subscription status in Supabase per user
  - Webhook handler for subscription events (created, cancelled, past_due)

- [ ] **Per-user item numbering**
  - Item numbers (V-000001 etc.) currently use a global sequence shared across all users
  - Migrate to per-user sequences so each user starts from V-000001

---

## Phase 2 — Multi-Platform Posting
> Goal: Post to eBay and Depop from the same app

- [ ] **eBay integration (API)**
  - Register eBay developer app (developer.ebay.com — free)
  - "Connect eBay account" OAuth flow in Settings page
  - Store access + refresh tokens per user in Supabase
  - Server route: create eBay listing from item data
  - Category mapping: app categories → eBay category IDs
  - Size/condition mapping to eBay specifics
  - Queue: add "platform" field so user can choose Vinted / eBay / both when scheduling
  - Mark as listed on eBay when done

- [ ] **Depop extension**
  - Add Depop content script to Chrome extension (same approach as Vinted)
  - Add `https://www.depop.com/sell*` to manifest host_permissions + content_scripts
  - Map fields: title, description, price, brand, size, condition, colour
  - Add Depop to sidebar platform indicator

- [ ] **Per-platform pricing**
  - Store separate prices per platform (e.g. £20 on Vinted, £25 on eBay)
  - UI: price fields per platform when scheduling
  - Extension: use platform-specific price when filling form

---

## Phase 3 — Inventory Intelligence
> Goal: Reduce manual work and catch mistakes automatically

- [ ] **Auto-delisting**
  - When item marked as sold on one platform, auto-cancel/delist from others
  - eBay: use Revise/End listing API
  - Vinted/Depop: notify user via in-app alert (no API — manual action required)
  - Prevent overselling across platforms

- [ ] **Sold item import**
  - eBay: poll sold orders via API and auto-mark items as sold in app
  - Vinted: no API — manual "mark as sold" remains (or via extension detecting sale confirmation page)

- [ ] **Duplicate listing detection**
  - Warn if same item is scheduled for multiple platforms without per-platform pricing

- [ ] **Bulk operations**
  - Select multiple items → generate listings in batch
  - Bulk schedule (e.g. "list all ready items over the next 7 days")
  - Bulk price adjustment (e.g. reduce all listed items by 10%)

---

## Phase 4 — Mobile Apps
> Goal: iOS and Android apps using the existing web codebase

- [ ] **Capacitor setup**
  - Add Capacitor to the existing React/Vite app (`npx cap init`)
  - iOS target (Xcode) + Android target (Android Studio)
  - Replace file input photo upload with Capacitor Camera plugin
  - Replace localStorage token storage with Capacitor Preferences plugin

- [ ] **Push notifications**
  - Queue reminders ("You have 2 items due to list today")
  - Sale alerts when eBay order comes in
  - Use Capacitor Push Notifications plugin + Supabase Edge Function to trigger

- [ ] **Mobile-optimised UI**
  - Review and improve layout on small screens
  - Swipe gestures for item cards
  - Camera-first photo flow (take photo → instant AI analysis)

- [ ] **App Store + Play Store submission**
  - Apple Developer account ($99/year)
  - Google Play Developer account ($25 one-time)
  - App store listings, screenshots, privacy policy

---

## Phase 5 — Growth Features
> Goal: Features that drive word-of-mouth and retention

- [ ] **Analytics dashboard**
  - Revenue over time chart
  - Best-performing categories / brands
  - Average time from purchase to sale
  - Platform comparison (what sells faster on eBay vs Vinted)

- [ ] **Price intelligence**
  - Suggest price based on recent sold comparables (eBay completed listings API)
  - Flag items that have been listed too long without selling

- [ ] **More marketplace extensions**
  - Facebook Marketplace content script
  - Gumtree content script (UK local selling)

- [ ] **Etsy integration (API)**
  - Official Etsy REST API
  - Good for vintage / handmade / collectible items
  - Same OAuth pattern as eBay

---

## Technical Debt / Housekeeping
- [ ] Add end-to-end tests (Playwright) for critical flows
- [ ] Rate limiting on AI endpoints
- [ ] Error monitoring (Sentry or similar)
- [ ] Proper logging on Railway
- [ ] API documentation for extension endpoints
- [ ] Admin panel (view all users, usage stats, support tools)

# Pamper Me Home Service — Management System

Internal, bilingual (Arabic / English) web app, installable on phones (PWA), for **Pamper Me Home Service**. Pamper Me is a women's home beauty-services business in Jeddah, Saudi Arabia. The app runs the whole operation: bookings, the team and its schedule, drivers, WhatsApp messages to customers, payments, commissions, salaries and reports.

- **Production domain:** `pamperme-ksa.com` (test: `test.tafraa.com`)
- **Repository branch:** `claude/pamper-me-management-system-6mdnfv`
- **Status (Sept 2026):** feature-complete for a team trial. External integrations are built but await merchant keys (see [§ 8](#8-integrations)).

---

## 1. Who uses it (roles)

| Role | Who | What they can do |
|---|---|---|
| **Owner** | Doha | Everything: staff, salaries, expenses, profit, settings, audit log |
| **Administrative manager** | Mohammed | Same permissions as the owner |
| **Moderator** | Alaa | Customers, bookings, calendar, trips, WhatsApp messages, payment links, her own commission. **Never** sees salaries, company expenses or net profit, even through direct API calls |
| **Specialist** | 4 specialists | Her own schedule, the customer location for her visits, her own commissions. English UI by default |
| **Driver** | Abu Ghaida | His own trips (today / upcoming / done), trip steps, his "on the way" message |

All permission checks are done **on the server** for every page, action and API route. Hiding a button is never the protection.

---

## 2. Features

### Bookings (orders)
- Booking wizard in six steps: customer → location → services & people → schedule → pricing → review.
- Services are chosen **by category**, with a separate packages tab. Prices come from the catalog and are **snapshotted** on each order line.
- Pricing order: offer price → **VIP discount 25 % of the offer** (automatic) → manual adjustment, which needs a reason. A delivery fee of 0–30 SAR sits outside the discount and the commission.
- Multi-visit orders and packages, with session balances tracked per package.
- **Operational day:** bookings start from 14:00 until 03:00 the next day, and 03:00 exactly still belongs to the previous day.
- Conflict prevention runs on the database, so specialists and drivers can't be double-booked.
- **Orders list:** table on desktop, cards on mobile.
  - Search by reference, name, phone or district.
  - Filters: period, status, driver, specialist, payment method, payment state, and "awaiting driver".
  - Sorting, and pagination at 25 per page.
- **Cancellation** of a whole order or a single visit, with a reason (customer request, unreachable, specialist unavailable, location issue, duplicate, operational, other + note).
  - Nothing is deleted.
  - Specialist and driver times are released, upcoming messages stop, open payment links close, and commissions are recalculated.
- **Customer invoice PDF**, in Arabic and English.
  - Clearly labelled *"not a tax invoice"*: no VAT number, no tax, no tax QR code.
  - Each issued version is immutable and numbered `PMD-YYMM-NNNN`.
  - Sent to the customer as a private link that expires after 30 days and can be revoked.

### Customers
- Search by name, phone (in any format), second phone, or district. The search ignores Arabic hamza, taa marbuta and diacritics.
- Full order history per customer.
- **VIP customers**, with a bulk import (paste from Excel or upload CSV, review, then confirm).
- Multiple addresses per customer. The **map picker** uses Google Maps when a key is set, and otherwise a free OpenStreetMap map. Picking a point suggests the district automatically.
- **Building photo**, taken from the gallery or the camera.
  - A 480 px thumbnail is made for lists and the driver screen, and GPS data is removed from the photo.
  - The photo is copied onto each order.

### Team, schedule and trips
- Staff records with effective-dated salaries and team membership. History is never rewritten, and employees are archived, never deleted.
- Days off, both weekly and on specific dates.
- Day and week calendar.
- Trip planner (drop-off and pick-up legs): travel time comes from Google Routes, or from a manual estimate plus a buffer.
- **Driver app:**
  - Tabs: today, upcoming, completed, and a date picker.
  - Steps in order: accept → on the way → arrived → done.
  - Map and "copy location" buttons, plus the building photo.
  - The screen refreshes itself every 5 seconds; a new trip appears in under 5 seconds.
- **Every driver step notifies the owner and the administrative manager.**

### WhatsApp messages to customers
Four message types: booking confirmation, a reminder 3 hours before the visit, "on the way", and a review request. Templates in Arabic and English can be edited in Settings.
- **Manual mode (default):**
  1. The system prepares the text.
  2. Staff open the chat in WhatsApp and press send there.
  3. Staff confirm "sent" in the app.
- **Automatic mode (optional, UltraMsg):** switched on per message type in Settings.
  - No duplicates.
  - Old messages are never sent when the mode is switched on.
  - Test customers are never messaged.
  - Failed messages return to manual sending with a notification.

### Payments and money
- Several payments per order: cash, bank transfer (needs approval), POS, and Tabby / Tamara recorded manually with a reference.
- **Online payment links** (the customer pays on the provider's page; the app never touches card data):
  - **Card — mada · Visa · Apple Pay** (Paymob)
  - **Tabby — 4 payments**
  - **Tamara — split it**
  
  A payment counts only after the server **verifies it with the provider**. Money is recorded exactly once, even if the provider retries.
- Cash custody and handovers.
- **Commissions:**
  - Specialist: 5 SAR per service unit, capped at 15 SAR per order. A package earns 10 SAR in total, split across its visits and specialists.
  - Moderator: by order value — 0 / 5 / 10 / 40 SAR.
  - Commission is earned only after the service is executed **and** fully paid.
- Company expenses, monthly payroll with advances, and month closing.
- Reports: booked sales, executed revenue, collections, deferred and remaining amounts, and a cash-flow view. Export is available.

### Notifications and mobile app
- A notification centre (the bell), plus phone push notifications that arrive even when the app is closed.
- Notification text never contains customer names, phone numbers or addresses, so nothing sensitive shows on a lock screen.
- An **"App setup on mobile"** page walks staff through four steps: install to the home screen, enable notifications (checked with the server), send a test push, and update.

### Security
- Accounts are created by management with a username and a temporary password; the password must be changed at first login. One-time invite links are also available.
- Passwords are hashed with Argon2 and are never logged or shown again.
- Login is limited to 20 failed attempts per 15 minutes, and cross-site requests are blocked.
- An append-only **audit log** (enforced by the database) records prices, payments, commissions, salaries, roles, account status and settings.
- No secrets in git. Keys live only in the hosting environment variables.

---

## 3. Technology

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, server actions, route handlers; `proxy.ts`) built with **webpack** |
| UI | React 19, Tailwind CSS 4, RTL/LTR using logical CSS properties |
| Language | TypeScript |
| Database | **PostgreSQL 16** (production: Neon) with **Drizzle ORM** and SQL migrations |
| Validation | Zod |
| Tests | Vitest: unit tests plus integration tests on a real Postgres |
| PDF | pdfkit with the embedded IBM Plex Sans Arabic font (OFL) and bidi-js |
| Maps | Google Maps JS / Geocoding / Routes, or Leaflet + OpenStreetMap |
| Push | Web Push (VAPID) |
| Money | Integer **halalas** everywhere; rounding happens only in `src/domain/money.ts` |
| Dates | Gregorian calendar, Latin digits, `Asia/Riyadh` time zone |

### Project layout

```
src/domain/        Pure business rules (money, pricing, commission, operational day, phone, messages, Paymob HMAC)
src/i18n/          Arabic (key schema) + English dictionaries, formatting
src/server/        Server only:
  db/              Drizzle schema and client
  auth/            Sessions, passwords, invites, login throttle
  authz/           Roles and permissions
  services/        Business operations (validate → authorize → transaction → audit)
  integrations/    Paymob, Tabby, Tamara, UltraMsg, Google Maps, reverse geocoding
  pdf/             Customer invoice PDF, bidi text shaping
  worker.ts        Background jobs (reminders, auto WhatsApp, push, payment re-checks)
src/app/           Routes: (auth) public pages, (app) signed-in pages, api/ JSON routes, pay/return, d/[token]
src/components/    UI components
drizzle/           SQL migrations 0000–0024 (additive only)
scripts/           migrate, seed, create-account, create-invite, worker, push-keys, icons, build-bundle
tests/             unit/ and integration/
docs/              Spec, decisions (D1–D84), deploy, integrations, design, acceptance, roadmap
```

---

## 4. Main pages

| Path | Page |
|---|---|
| `/` | Dashboard (depends on the role) |
| `/orders`, `/orders/new`, `/orders/[id]` | Orders list, booking wizard, order details |
| `/customers`, `/customers/[id]`, `/customers/vip-import` | Customers, profile and history, VIP import |
| `/calendar`, `/trips`, `/my-trips`, `/schedule` | Calendar, trip planner, driver screen, specialist schedule |
| `/messages` | WhatsApp messages (tabs: due now / scheduled / done) |
| `/payments/links` | Payment links (new, all, open, paid, unlinked, needs settlement) |
| `/cash`, `/commissions`, `/expenses`, `/payroll`, `/reports` | Money |
| `/staff`, `/teams`, `/catalog`, `/settings`, `/audit` | Management |
| `/notifications`, `/account`, `/app-setup` | Personal |
| `/pay/return`, `/d/[token]` | Public: payment return page, customer PDF link |
| `/api/health` | Owner-only diagnostics (database updates, table checks, `?apply=1` re-applies updates) |

---

## 5. Running locally

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and TEST_DATABASE_URL
npm run db:migrate
npm run db:seed               # starting employees (no active logins)
npm run account:create -- --role=owner --username=doha
npm run dev
```

| Command | Purpose |
|---|---|
| `npm test` | Unit and integration tests (**198 passing**) |
| `npm run lint` | TypeScript type-check |
| `npm run build` | Production build (`next build --webpack`) |
| `npm run db:generate` | New SQL migration after a schema change |
| `npm run worker` | Background worker, if it is not run inside the app |
| `npm run push:keys` | Generate the VAPID keys once |

---

## 6. Environment variables (names only — values live in the hosting panel)

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Database (required) |
| `APP_BASE_URL` | Public URL, e.g. `https://pamperme-ksa.com` (required) |
| `APP_ENV`, `NODE_ENV` | `production` |
| `RUN_WORKER_IN_APP` | `1` on single-process hosts (Hostinger) |
| `MIGRATE_ON_START` | Database updates at start-up (on by default; `0` turns it off) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Phone notifications |
| `GOOGLE_MAPS_BROWSER_KEY` | Google map in the browser (otherwise OpenStreetMap is used) |
| `GOOGLE_MAPS_API_KEY` | Server: travel times and district names |
| `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATIONS`, `PAYMOB_BASE_URL` | Card, mada and Apple Pay links |
| `TABBY_SECRET_KEY`, `TABBY_MERCHANT_CODE`, `TABBY_WEBHOOK_SECRET`, `TABBY_BASE_URL` | Tabby links |
| `TAMARA_API_TOKEN`, `TAMARA_NOTIFICATION_TOKEN`, `TAMARA_BASE_URL` | Tamara links |
| `ULTRAMSG_INSTANCE_ID`, `ULTRAMSG_TOKEN` | Automatic WhatsApp |

---

## 7. Deployment

- **Hostinger (Node.js panel):**
  - Build: `npm run build`. Start: `npm start`.
  - The host's old system library (glibc) is handled by the webpack build and the pinned WASM compiler.
  - Database updates are applied **automatically when the app starts**, with a lock so two processes can't apply them at once.
- **Docker alternative:** app + PostgreSQL + Caddy (automatic HTTPS) + daily backups kept 30 days.
- All migrations are additive, so no production data is ever reset. Take a Neon backup (branch) before each release.
- **Rollback:** redeploy the previous commit. The database stays compatible unless records with the new states already exist.
- **After each deploy:** sign in as the owner and open `/api/health` — it should return `"ok": true`.

Full steps are in [`docs/DEPLOY.ar.md`](DEPLOY.ar.md).

---

## 8. Integrations

| Integration | Status | Needs |
|---|---|---|
| Card — mada · Visa · Apple Pay (Paymob) | Built, tested with a development mock | Paymob keys + webhook URL `/api/payments/paymob/webhook` |
| Tabby | Built, tested with a development mock | Tabby keys + webhook `/api/payments/tabby/webhook` with the `X-Pamper-Webhook` header |
| Tamara | Built, tested with a development mock | Tamara tokens (sandbox first) |
| Automatic WhatsApp (UltraMsg) | Built, tested with a development mock | UltraMsg instance + token; the phone must stay online |
| Google Maps (map, geocoding, routes) | Built | Browser key + server key |
| OpenStreetMap map | Built — works without keys | — |
| Web Push | Built | VAPID keys, HTTPS |

None of these have been tested against a live provider account yet. Test with sandbox keys first. Details: [`docs/INTEGRATIONS.ar.md`](INTEGRATIONS.ar.md).

---

## 9. Open items

- [ ] Confirm the production deployment runs the latest commit, and that `/api/health` returns `ok: true`.
- [ ] Rotate the database password (a connection string was shared earlier) and update `DATABASE_URL`.
- [ ] Add the Google Maps keys.
- [ ] Add the Paymob / Tabby / Tamara sandbox keys → test a small real link → switch to live keys.
- [ ] UltraMsg: link the number, send a test message, enable the message types.
- [ ] Test phone notifications on real iPhone and Android devices.
- [ ] Run a one-week team trial on test data (`is_test`) before real data.
- [ ] Not built yet: automatic assignment of a team's default driver.

---

## 10. Further documents

| File | Content |
|---|---|
| [`docs/requirements/SPEC.ar.md`](requirements/SPEC.ar.md) | Final requirements (source of truth) |
| [`docs/DECISIONS.md`](DECISIONS.md) | Every non-obvious decision (D1–D84) |
| [`docs/DEPLOY.ar.md`](DEPLOY.ar.md) | Deployment, update and rollback |
| [`docs/INTEGRATIONS.ar.md`](INTEGRATIONS.ar.md) | Activating each integration |
| [`docs/SETUP.ar.md`](SETUP.ar.md) | Local setup and secrets |
| [`docs/DESIGN.md`](DESIGN.md) | Brand colours and contrast |
| [`docs/ACCEPTANCE.md`](ACCEPTANCE.md) | Acceptance tests |
| [`docs/ROADMAP.md`](ROADMAP.md) | Phases and status |
| [`CLAUDE.md`](../CLAUDE.md) | Developer rules |

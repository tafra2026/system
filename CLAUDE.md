# Pamper Me Home Service — Internal Management System

Internal, bilingual (Arabic/English) PWA for a women's home beauty-services business in Jeddah, KSA.
Talk to the owner/team **in Arabic**, simply; they are not developers.

- **Source of truth for requirements:** `docs/requirements/SPEC.ar.md` (final, replaces older chats).
- **Decisions taken to fill gaps:** `docs/DECISIONS.md` — add an entry for every non-obvious choice.
- **Phase plan & status:** `docs/ROADMAP.md`.
- **Run / deploy / secrets:** `docs/SETUP.ar.md`.
- **Design tokens & contrast:** `docs/DESIGN.md`.

## Stack

Next.js 16 (App Router, server actions, route handlers; `proxy.ts` replaces middleware) · React 19 ·
TypeScript · PostgreSQL 16 · Drizzle ORM (SQL migrations in `drizzle/`) · Zod · Tailwind CSS 4 · Vitest.
Next 16 differs from older versions — read `node_modules/next/dist/docs/` before using an API you are unsure of.

## Layout

```
src/domain/     Pure business rules (money, pricing, commission, operational day, phone). No I/O. Unit-tested.
src/i18n/       Central dictionaries (ar.ts is the key schema; en.ts must match), formatting helpers.
src/server/     Server-only: db (schema, client), auth (sessions, passwords, invites, login throttle), authz (permissions),
                services (business operations: validate → authorize → transaction → audit),
                integrations (Paymob, Google Maps, Web Push), pdf (customer document, bidi text).
src/app/        Routes. (auth) = public pages, (app) = signed-in pages, api/ = JSON route handlers.
src/components/ UI components (logical CSS props only: ms/me/ps/pe/start/end — never left/right).
scripts/        migrate, seed, create-invite, create-account, worker (reminders + Web Push), push-keys, icons.
tests/          unit/ (pure) and integration/ (real Postgres test DB).
```

## Non-negotiable rules

1. **Authorization lives on the server.** Every server action, route handler and service function calls
   `requirePermission`/`requireUser` itself. Hiding UI is never the protection. Moderator must never read
   salaries, company expenses or net profit — even via direct API calls.
2. **Money is integer halalas** (`*_halalas` columns, `number` in TS). Rounding: half-up to the nearest halala,
   only in `src/domain/money.ts`. Never use floats for stored amounts.
3. **Bilingual everything.** No hard-coded UI strings; add keys to `src/i18n/dictionaries/ar.ts` *and* `en.ts`.
   English UI must contain no Arabic (except user-entered data such as names/notes). Arabic = RTL, English = LTR.
   Specialists default to English, everyone else to Arabic; each user picks their own language.
   Customer message language is independent of the staff UI language (default Arabic).
   Dates always Gregorian (`-u-ca-gregory`), Latin digits, timezone `Asia/Riyadh`.
4. **History is append-only.** Salaries and team membership are effective-dated rows; never rewrite past rows.
   Employees with records are deactivated/archived, never deleted. Prices are snapshotted on order lines.
5. **Audit log** (`audit_log`, DB-enforced append-only) for price edits, payments, commissions, salaries,
   roles/permissions, account status.
6. **No fake data or fake buttons** in the product UI. Empty states instead of invented stats.
   Test/demo records carry `is_test = true` and are excluded from financial reports.
7. **No secrets in git.** `.env*` is ignored except `.env.example`. No shared or published passwords;
   accounts are created by management with a username + (by default temporary) password, or via
   one-time, expiring invite links. Passwords are never logged, audited or shown again (D61).
8. **Never** send real WhatsApp messages, trigger live payments, or call live Tabby/Tamara during tests.
   Any mock must be clearly labelled as a development mock.
9. Do not log sensitive data (passwords, tokens, salaries, customer phone/address) in technical logs.

## Binding business rules (summary — full text in the spec)

- Operational day: bookings start 14:00; last start 03:00 next day; **03:00 exactly belongs to the previous
  operational day**. Store `operational_date` separately from the real timestamp.
- Pricing order: offer price → VIP discount (25% of *offer*, auto) → manual final adjustment (with reason).
  Final ≤ base price, never negative, free only as an explicit reasoned adjustment. Delivery fee 0–30 SAR,
  outside VIP discount and moderator commission.
- Specialist commission: 5 SAR per standalone service unit she executed; cap 15 SAR per specialist per
  original order (across visits). Package = 10 SAR total, split equally across visits then across the
  specialists of each visit; package components earn nothing extra.
- Moderator commission per original order on final services total (after discounts, excl. delivery):
  <250 → 0; 250–<500 → 5; 500–1000 incl. → 10; >1000 → 40.
- Commission is earned only after execution **and** full payment; never duplicated by retries/webhooks.
- Orders/visits are cancelled with a reason (D72), never deleted. Paymob payments count only from a verified
  webhook (D75). The customer PDF is never called a tax invoice (D76).

## Commands

```
npm run dev            # local dev server (needs Postgres + .env)
npm test               # unit + integration tests (integration uses TEST_DATABASE_URL)
npm run lint           # TypeScript type-check
npm run db:generate    # generate SQL migration after editing src/server/db/schema.ts
npm run db:migrate     # apply migrations to DATABASE_URL
npm run db:seed        # seed starting employees (idempotent; no login accounts are activated)
npm run owner:invite   # print a one-time account-setup link for an employee (server access required)
npm run account:create # create an account (or reset a password) with a hidden password prompt — first owner account
npm run worker         # background worker: due WhatsApp reminders + Web Push delivery (every 15 s)
npm run push:keys      # generate VAPID keys once per installation (put them in the server .env)
```

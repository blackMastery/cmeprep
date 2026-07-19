# cmeprep.me

Practice questions and timed mock exams for medical board and exit
examinations. Next.js 16 (App Router) + Supabase + Tailwind v4 + shadcn/ui.

## What's built

- **Design system** — brand tokens (coral `#E85D42`, teal `#3EBFA0`, sun
  `#FFD34E`, ink, blush) in Tailwind v4 `@theme inline`, the coral→teal
  gradient wash, Poppins for the wordmark/headings/question stems with
  Public Sans on body copy, the stethoscope logo lockup, ECG motif, pill
  buttons, light + dark.
- **Marketing page** — photo hero under a brand scrim, stats row, device shot
  with a sample answered question, problem / timed exams / examinations /
  outcomes sections, 3-tier pricing, CTA band, footer.
- **Auth** — register, email verification, login, forgot/reset password,
  banned-user gate.
- **Test engine** — new-test wizard, timed take screen (question palette,
  flag-for-review, autosave + resume, keyboard nav), server-side scoring,
  results, and review mode.
- **Dashboard** — attempted / accuracy / streak, weak areas, past tests,
  trial usage with upgrade prompt.

- **Admin** — role-gated `/admin`: subjects & topics CRUD with reorder and
  safe delete, question list (search, filters, pagination), question editor
  with dynamic option rows and a live student preview, publish/draft, soft
  delete, image upload to Supabase Storage, and an audit log.

**Not built yet:** bulk upload, users table, question-bank browser, PayPal,
admin analytics, Sentry, CI, Playwright.

## Getting started

Requires Docker running (for local Supabase).

```bash
npm install
cp .env.example .env.local

npx supabase start        # prints your local URL + keys
npx supabase db reset     # applies migrations + seed

# paste the printed PUBLISHABLE_KEY / SECRET_KEY into .env.local
npm run dev
```

Verification and password-reset emails land in Mailpit at
http://127.0.0.1:54324 during local development.

### Making yourself an admin

Register through the app, verify your email, then:

```sql
update profiles set role = 'admin' where id = '<your-user-uuid>';
```

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run build          # production build
npm run lint           # eslint
npx vitest run         # unit tests
npx tsc --noEmit       # typecheck
npx supabase db reset  # rebuild local DB from migrations + seed
```

## Architecture notes

### Next.js 16 specifics

`middleware.ts` is now **`proxy.ts`** (nodejs runtime only). `cookies()`,
`params`, and `searchParams` are Promises — synchronous access was removed in
v16. Route types come from `npx next typegen`.

### Security model

`proxy.ts` only refreshes the auth cookie and does cheap optimistic
redirects — the Next docs are explicit that it must not be the authorization
layer, since it runs on every prefetch. Real enforcement lives in three
places:

1. `app/(app)/layout.tsx` validates the session and loads the profile.
2. Route handlers verify the caller before using the service-role client.
3. Postgres RLS is the backstop on every table.

**Table privileges are granted explicitly** (migration `..._grants.sql`).
Tables created by the `postgres` role — which is what runs migrations —
inherit a default ACL with no `SELECT/INSERT/UPDATE/DELETE` for
`anon`/`authenticated`/`service_role`. Without those grants every query fails
with "permission denied", including from the service client.

**Answer correctness never reaches the browser mid-test.**
`question_options` is revoked from client roles entirely; students read
options through the `question_options_public` view, which has no `is_correct`
column. Only `lib/tests.ts` and `lib/results.ts` (both `server-only`, both
using the service client) read correctness, and results/review refuse to
serve it until the test is no longer `in_progress`.

### Server-authoritative timing

`tests.expires_at` is set at creation. The client countdown corrects for
clock skew against the server time sent at render, so a tampered device clock
changes nothing. Submitting past the deadline (+30s network grace) is
rejected, and any expired test found by a read path is scored from its staged
answers rather than left hanging.

### Append-only attempts

Every submitted answer writes one immutable row, powering accuracy, weak
areas, and streaks without backfilling. In-progress selections live
separately in `test_answers` so `attempts` can keep `is_correct NOT NULL`.

The unique constraint on `attempts (test_id, question_id)` is deliberately
**not** partial: Postgres only uses a partial index for `ON CONFLICT` when the
statement repeats its predicate, which PostgREST cannot express — so a partial
index silently broke the submit upsert. NULL `test_id` (practice mode) still
repeats freely because Postgres treats NULLs as distinct.

### Scoring

Multi-correct questions are **all-or-nothing** in v1: the selection must match
the correct set exactly. See `lib/scoring.ts` and its unit tests.

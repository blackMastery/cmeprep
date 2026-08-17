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
  banned-user gate, Google + LinkedIn sign-in.
- **Test engine** — new-test wizard, timed take screen (question palette,
  flag-for-review, autosave + resume, keyboard nav), server-side scoring,
  results, and review mode.
- **OSCE stations** — open-ended questions graded by an AI judge
  (OpenAI, `lib/openai.ts`) against an admin-authored model answer:
  untimed sessions, per-station check-and-lock, binary verdicts feeding the
  normal stats, paid-only with a 50-grades/day cap, admin grading log and
  student "report this grade" flags. Requires `OPENAI_API_KEY`.
- **Dashboard** — attempted / accuracy / streak, weak areas, past tests,
  trial usage with upgrade prompt.

- **Admin** — role-gated `/admin`: subjects CRUD with reorder and
  safe delete, question list (search, filters, pagination), question editor
  with dynamic option rows and a live student preview, publish/draft, soft
  delete, image upload to Supabase Storage, and an audit log.

- **Payments** — PayPal one-time captures scoped per exam, with the money
  recorded in `payments` before any grant is attempted, amount-aware refunds,
  and a `pg_cron` reconciliation sweep at `/api/cron/reconcile`. Gaps are
  tracked in [payments-backlog.md](payments-backlog.md).

**Not built yet:** admin analytics, receipts and transactional email, an admin
payments view, Sentry, CI, Playwright.

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

### Social sign-in (Google / LinkedIn)

The buttons on `/login` and `/register` need OAuth credentials; without them
the providers answer with an error that surfaces on `/login?error=`.

1. **Google** — [console.cloud.google.com](https://console.cloud.google.com):
   configure the OAuth consent screen, then *APIs & Services → Credentials →
   Create credentials → OAuth client ID → Web application*. Authorized
   redirect URIs: `http://127.0.0.1:54321/auth/v1/callback` (local stack) and
   `https://<project-ref>.supabase.co/auth/v1/callback` (hosted).
2. **LinkedIn** — [developer.linkedin.com](https://developer.linkedin.com):
   create an app attached to a verified Company Page, request the product
   **"Sign In with LinkedIn using OpenID Connect"** (the legacy product does
   not work — Supabase's provider is `linkedin_oidc`), and add the same two
   redirect URLs under *Auth → Authorized redirect URLs*.
3. **Local stack** — put the four values from `.env.example`
   (`SUPABASE_AUTH_EXTERNAL_…`) in a repo-root `.env` (gitignored; the
   Supabase CLI does not read `.env.local`), then restart with
   `npx supabase stop && npx supabase start`.
4. **Hosted project** — in the Supabase dashboard enable **Google** and
   **LinkedIn (OIDC)** under *Authentication → Sign In / Providers* with the
   same credentials, and add `https://www.cmeprep.me/auth/callback` to
   *Authentication → URL Configuration* — unlisted redirect targets silently
   fall back to the Site URL.

Notes: an OAuth identity with the same **verified** email as an existing
account is linked into that account (Supabase default), so one user can hold
both login methods. OAuth-only users can still set a password from
*Profile → Security*, which simply adds an email+password login.

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

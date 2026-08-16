# cmeprep — User Testing Guide

Every user-facing flow in the app, in the order a tester should walk them.
Each step lists what to do and **what you should see** — if reality differs,
that's a bug worth logging (template at the bottom).

Estimated time for a full pass: **2–3 hours**. The sections are independent
once setup is done, so they can be split between testers.

---

## Quick reference

| Thing | Value |
|---|---|
| App | http://localhost:3000 |
| Email inbox (Mailpit) | http://127.0.0.1:54324 |
| Supabase Studio (DB browser) | http://127.0.0.1:54323 |
| Supabase API | http://127.0.0.1:54321 |

### Test credit card details

Use these on the PayPal sandbox checkout — **never a real card**.

```
Card number:  4032038648866691
Expiry date:  07/2029
CVC code:     604
```

---

## 1. Setup

Docker must be running.

```bash
npm install
cp .env.example .env.local

npx supabase start        # prints your local URL + keys
npx supabase db reset     # applies migrations + seed data

# paste the printed PUBLISHABLE_KEY / SECRET_KEY into .env.local
npm run dev
```

**PayPal:** put your sandbox app's client id in **both**
`NEXT_PUBLIC_PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_ID`, and the secret in
`PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_WEBHOOK_ID` and `CRON_SECRET` **empty** —
locally the capture route alone grants access, and the webhook/cron endpoints
deliberately return 503. If the client id is missing, checkout shows "Payments
are not configured yet" instead of the buttons.

To re-run testing from a clean slate at any point: `npx supabase db reset`
(this wipes all accounts and test history, and you'll re-register).

---

## 2. What's in the database after a reset

Read this before testing — several "bugs" testers report are really just the
thin seed data.

- **No user accounts exist.** Everyone registers through the app (§3).
- **One exam:** *Medical Board Exam*. Because there's only one, the new-test
  wizard **skips its Exam step** — that's correct behaviour, not a missing screen.
- **Four subjects:** Medicine (7 questions), Surgery (3), Obstetrics &
  Gynaecology (3), Paediatrics (3).
- **16 questions total**, all published, all with explanations. 14 single-answer,
  **2 multi-answer** (one in Medicine — Graves; one in Surgery — mesenteric
  ischaemia). Multi-answer scoring is all-or-nothing.
- **Trial accounts get 2 test credits** (`trials_limit = 2`).
- **Plans:** Trial $0 · 1 month **$144.00** · 3 months **$216.00** (featured) ·
  Team **$1,200.00/yr** (org, 90 seats).

**Consequences to plan around:**

- Build **10-question tests**. Asking for 20/40/60 will short-fill or fail.
- To see a **multi-answer** question reliably, pick Medicine + Surgery.
- Readiness scores need **≥20 answered questions per person** — that's two
  10-question tests (retakes create fresh attempt rows, so repeating the same
  questions works fine).
- A trial account burns its 2 credits fast. Either pay (§5), or top it up from
  the admin user page (§11), or register another account.

---

## 3. Accounts to create

Register these up front — later sections assume they exist. Use any addresses
you like; all mail lands in Mailpit.

| Label | Suggested email | Role | Needed for |
|---|---|---|---|
| **Admin** | `admin@test.local` | platform admin (set by SQL) | §11, topping up trial credits |
| **Student** | `student@test.local` | trial → paid | §4–§8 |
| **Org owner** | `orgadmin@test.local` | org admin | §9–§10 |
| **Org member** | `member@test.local` | org member | §9–§10 |

### Making the admin

Register `admin@test.local`, verify it, then in Supabase Studio's SQL editor
(http://127.0.0.1:54323) or `psql`:

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@test.local');
```

Sign out and back in. An **Admin** link appears in the sidebar.

---

## 4. Auth

- [ ] **Register** — `/register`, full name + email + password (min 8 chars).
      Lands on `/verify-email`.
- [ ] **Verify** — open Mailpit, click the confirmation link. You land signed in
      on `/dashboard`.
- [ ] **Login before verifying** — try logging in with an unverified account.
      Expect a deliberately vague error ("Incorrect email or password, or your
      email is not yet verified") — it must **not** reveal which.
- [ ] **Wrong password** — same generic error.
- [ ] **Protected route while logged out** — visit `/dashboard` in a private
      window. Redirects to `/login?next=/dashboard`; after logging in you land
      back on `/dashboard`, not the generic home.
- [ ] **Forgot password** — `/forgot-password`. Message is identical whether or
      not the address exists (no account enumeration). Email arrives in Mailpit.
- [ ] **Reset password** — follow the link, set a new password, land on
      `/dashboard`. Old password no longer works.
- [ ] **Rate limit** — request a reset twice within 60s; the second is refused.
- [ ] **Change password while signed in** — `/profile` → change-password form.
      You stay on `/profile` (you are *not* bounced to the dashboard).
- [ ] **Logout** — header menu → back to `/login`.
- [ ] **Banned user** — as admin (§11) ban the student, then load any page as
      them: everything redirects to `/banned` with a log-out button. Unban and
      confirm normal access returns.

---

## 5. Payments & access

Do this as **Student**, who starts as a trial user.

- [ ] **Pricing** — `/` → `#pricing`. Three personal plan cards render from the
      database.
- [ ] **Checkout** — click *1 month*. Lands on `/checkout/<planId>`. The page
      shows the plan summary and an **exam picker**; with one seeded exam it
      auto-selects *Medical Board Exam*.
- [ ] **Pay** — click the PayPal button, log in with a **PayPal sandbox buyer
      account**, or choose the card option and use the test card:
      **4032038648866691 · 07/2029 · CVC 604**.
- [ ] **Success** — you land on `/checkout/success` naming the plan, exam and
      access end date.
- [ ] **Access reflected** — `/profile` shows an active subscription with the
      end date; `/dashboard` no longer shows the trial meter; `/tests/new` shows
      the exam unlocked.
- [ ] **Money recorded** — in Studio, `select * from payments;` — one row with a
      `paypal_order_id`, `amount_cents = 14400`, and a non-null `subscription_id`.
- [ ] **Stacking** — buy the *3 months* plan too. The end date **extends** rather
      than replacing, and the checkout page said so before you paid.
- [ ] **Trial exhaustion** (needs a fresh trial account) — start and submit two
      tests, then open `/tests/new`. The wizard is replaced by an upgrade card.
- [ ] **Abandon a payment** — open checkout, start the PayPal flow, close the
      popup. No subscription is granted and no `payments` row appears.

> Expected locally: `/api/paypal/webhook` returns **503** (no `PAYPAL_WEBHOOK_ID`)
> and `/api/cron/reconcile` returns **503** (no `CRON_SECRET`). Both are correct —
> they refuse to run unauthenticated rather than degrading.

---

## 6. Exam mode (timed)

As **Student**, with access to the exam.

- [ ] **Wizard** — `/tests/new`. Step 1 is **Mode**; choose *Exam mode*. (No Exam
      step — only one exam is seeded.) Pick subjects, then Format: **10
      questions**, mixed difficulty, 15 minutes.
- [ ] **Take screen** — countdown runs, question palette shows answered/flagged
      dots, letter keys A–D select answers, arrow keys move, `f` flags.
- [ ] **No correctness leaks** — nothing on screen reveals the right answer.
      (Optional: open DevTools → Network and confirm no payload contains
      `is_correct` or an explanation.)
- [ ] **Autosave + resume** — answer a few questions, close the tab, reopen
      `/tests/<id>/take`. Your answers and flags are intact and the clock has
      kept running.
- [ ] **Submit** — confirm the dialog warns about unanswered questions, then
      submit → `/tests/<id>/results`.
- [ ] **Results** — score %, correct/total, blanks, duration, per-subject bars.
- [ ] **Review** — "Review wrong answers" → correct answers, your selections and
      the explanations. Toggle *All* vs *Wrong only*.
- [ ] **Expiry** — start a test with a **5-minute** limit, leave it, and come back
      after the clock runs out. It is scored from whatever was staged and you
      land on results, not a live-looking test.

---

## 7. Tutor mode (untimed, instant feedback)

The newest flow — worth the most attention.

- [ ] **Start** — `/tests/new` → **Tutor mode**. The Format step has **no time
      limit** control and the summary says *Untimed*. Button reads "Start
      practising".
- [ ] **Instant reveal** — click an answer on a single-answer question. It grades
      immediately: correct/incorrect colouring, the correct option marked, and the
      explanation inline underneath.
- [ ] **Locked** — you cannot change that answer afterwards; the options are
      disabled.
- [ ] **Keyboard** — on a fresh question press a letter key. It only **highlights**
      — nothing is graded until you press **Enter**. (This is deliberate: a stray
      keypress must never lock an answer.)
- [ ] **Multi-answer** — reach a multi-answer question (Medicine/Surgery). It does
      *not* grade on first click; you tick options and press **Check answer**.
- [ ] **Bookmark + note** — after a reveal, bookmark the question and type a note.
      Both save without leaving the page.
- [ ] **Tally + progress** — the header shows a running "N/M correct"; the palette
      turns green/red per graded question.
- [ ] **Missed-only filter** — get at least one wrong, then use the missed-only
      chip; Next/Previous jump between missed questions.
- [ ] **Save & exit → resume** — leave mid-session, then reopen from
      `/tests`. Graded questions come back **already revealed with their
      explanations**; ungraded ones are still answerable.
- [ ] **Never expires** — a tutor session left overnight is still resumable and
      still says *In progress*. This is by design.
- [ ] **Finish with blanks** — press *Finish session* with questions unchecked.
      The dialog says they won't count.
- [ ] **Tutor results** — the score is **correct ÷ answered** (not ÷ total), the
      page shows how many you checked and skipped, and there is **no duration**
      stat. Answering 4 of 10 all correctly shows **100%**, with "4 of 10 checked".
- [ ] **Stats credited immediately** — answer a few tutor questions but *don't*
      finish; check `/dashboard`. Attempted count and streak have already moved.
- [ ] **History badge** — `/tests` shows the session tagged **Tutor** with its
      answered/total alongside the score.
- [ ] **Dashboard split** — once you have both exam and tutor attempts, the
      Accuracy card hint reads "Exam X% · Tutor Y%".

---

## 8. Library & history

- [ ] **Bookmarks** — `/bookmarks` lists everything you saved, paginated.
- [ ] **Notes** — a note written in tutor mode also shows on the same question in
      post-test review.
- [ ] **History** — `/tests` filters by All / In progress / Submitted /
      Abandoned. In-progress rows say *Resume*, finished rows *View*.
- [ ] **Profile** — `/profile` shows lifetime stats, plan and subscription
      history, and (if you're in an org) your department label.

---

## 9. Organisations — setup and membership

As **Org owner**.

- [ ] **Create** — `/teams` → *Create your organisation*, or go to `/org/new`.
      After creating you land on `/org/billing`.
- [ ] **Buy seats** — purchase the **Team** plan with the test card above.
      Members then practise without spending trial credits.
- [ ] **Invite** — `/org/members` → invite `member@test.local`.
- [ ] **Copy the link** — invites are **not emailed**. Use the *Copy link* button
      and send/paste it yourself. (Brand-new email addresses do get a Supabase
      account-invite email in Mailpit; existing accounts don't.)
- [ ] **Accept** — open the link as the Org member and accept → `/dashboard`,
      now showing the org name.
- [ ] **Invite banner** — invite a *third* address that already has an account;
      that user sees a banner on their dashboard offering to join.
- [ ] **Wrong-email invite** — open an invite link while signed in as the wrong
      user. It refuses — invites are bound to the address.
- [ ] **Seats** — the seat meter counts members **plus pending invites**.
- [ ] **Departments** — on `/org/members`, create "ER" and "Cardiology" and
      assign the member to one.
- [ ] **Roles** — promote the member to org admin and back.
- [ ] **Remove** — remove a member and confirm they lose org access (their own
      test history survives).

---

## 10. Organisations — assignments & readiness

### Assignments

- [ ] **Create (exam mode)** — `/org/assignments`: title, due date, exam,
      subjects, **10 questions**, Exam mode, 15 minutes.
- [ ] **Create (tutor mode)** — a second one in Tutor mode. The **Minutes field
      disappears** and the row reads *Tutor*.
- [ ] **Member view** — as the member, `/assignments` lists both with due dates
      and status.
- [ ] **Start** — the member's test uses the prescribed config verbatim (they
      configure nothing).
- [ ] **Mode override** — under the Start button there's a smaller "or practise
      it in tutor mode" / "or take it as a timed exam" link. Use it.
- [ ] **Override is labelled** — after finishing, the assignment row notes the
      mode it was actually done in, and the admin's progress badge counts it
      separately ("N in tutor mode").
- [ ] **Tutor completion rule** — finish a **tutor** assignment with some
      questions skipped. It does **not** count as complete for the org (the
      member's status stays In progress / Overdue). Complete every question and it
      then counts. *This is the anti-gaming rule — a 3-of-40 run must not read as
      done.*
- [ ] **Department audience** — create an assignment targeted at a department and
      confirm only its members see it.

### Readiness (the risk-flagging feature)

Readiness needs evidence: **≥20 answered questions** on the exam per member,
or the band correctly reads *Not enough data*.

- [ ] **Cold start** — a brand-new member shows **Not enough data** with no
      score number. (Fabricated precision here would be the bug.)
- [ ] **Generate data** — as the member, complete two 10-question tests.
- [ ] **Dashboard** — `/org` now shows a 0–100 score, a band badge, reason chips
      and an 8-week trend sparkline.
- [ ] **No-mock cap** — if the member has only done **tutor** sessions, the score
      is capped below 75 with a **"No timed mocks"** chip. Complete one exam-mode
      test and the cap lifts.
- [ ] **Reason chips** are legible and match the picture (e.g. *Low coverage*
      while only Medicine has been practised — Surgery/O&G/Paediatrics need ≥5
      attempts each at ≥50%, which takes a couple of tests).
- [ ] **Sorting** — click the *Readiness* header to sort; click again to reverse.
      Members with no score stay at the bottom either way.
- [ ] **At-risk filter** — the *At risk only* chip narrows the table.
- [ ] **Drill-down** — click a member's name → signal breakdown (accuracy vs pass
      mark, trend, coverage, cadence), per-subject bars, timed-mock history and a
      pacing note.
- [ ] **Privacy boundary** — the drill-down shows **scores and aggregates only**.
      There is no way to see the member's actual answers, notes or bookmarks
      anywhere in `/org`. *Any leak here is a serious bug.*
- [ ] **Foreign member** — paste another org's member id into
      `/org/members/<uuid>` → 404.
- [ ] **Pass mark** — `/org/settings`, change the pass mark from 60 to 85. Scores
      drop and more members fall below the line.
- [ ] **Sitting date** — set a date in `/org/settings` → *Exam sittings*. `/org`
      shows "N days until the … sitting". Set a **past** date: it reads "sitting
      date has passed" and **no score changes** (the date is framing only).
- [ ] **Member's own view** — as the member, `/dashboard` has an **Exam
      readiness** card with the same score, phrased as guidance ("Add a timed mock
      this week"). It must **never** say "at risk" or mention that admins see a
      flag.
- [ ] **Departments strip** — shows average readiness and at-risk counts per
      department; clicking one filters the table and the headline cards.
- [ ] **CSV export** — the *Export CSV* button downloads a file with name, email,
      department, score, band, reasons and accuracy.

### Org private content & admin

- [ ] **Private bank** — `/org/content`: create a private exam, specialty and
      subject, then a question. It appears for members but **never** in the public
      catalogue.
- [ ] **Bulk import** — `/org/content/import/<examId>`: download the template,
      fill a couple of rows, upload, check the preview report, then commit.
- [ ] **Branding** — `/org/settings`: upload a logo; it appears in the app shell
      for members.
- [ ] **Audit** — `/org/audit` lists your admin actions (invites, role changes,
      assignment creation, settings edits).

---

## 11. Platform admin

As **Admin**.

- [ ] **Overview** — `/admin` counts published/draft questions, exams, users, plans
      and open messages.
- [ ] **Taxonomy** — `/admin/exams`: create an exam, specialty and subject;
      reorder; retire an exam and confirm it stops being sellable while existing
      subscribers keep access.
- [ ] **Question editor** — `/admin/questions/new`: dynamic option rows, live
      student preview, image upload, save as draft, then publish.
- [ ] **Validation** — try saving a single-answer question with two correct
      options, and a multi-answer one with only one. Both are refused with a
      readable message.
- [ ] **List tools** — `/admin/questions`: search, filter by subject/difficulty/
      published, bulk publish/unpublish, bulk delete. Deletes are **soft** — past
      papers still resolve.
- [ ] **Bulk import** — `/admin/exams/<id>/import`: template → upload → preview
      (per-row errors, duplicate warnings) → commit.
- [ ] **Users** — `/admin/users`: search, open the student, change role, **top up
      trial credits** (handy for testing), reset trials used, ban/unban.
- [ ] **Grant access manually** — on a user, grant a subscription by plan preset
      + exam, or with a manual end date. Confirm the user sees it on `/profile`.
      Then cancel it and confirm access ends.
- [ ] **Orgs** — `/admin/orgs`: create an org, grant it a subscription, suspend it.
      Suspended orgs' members lose org access immediately (banner explains why);
      unsuspend restores it.
- [ ] **Plans** — `/admin/plans`: edit a price and confirm `/#pricing` updates.
- [ ] **Messages** — submit the `/about#contact` form as a logged-out visitor,
      then handle it in `/admin/messages`.

---

## 12. Cross-cutting checks

- [ ] **Mobile** — run §6 and §7 at 390px width. The take screen's footer nav is
      thumb-reachable and the palette opens as a sheet.
- [ ] **Dark mode** — toggle the theme; check the dashboard, take screen, tutor
      reveal colours and the org readiness table.
- [ ] **Keyboard only** — complete a test without touching the mouse.
- [ ] **Screen-reader sanity** — correct/incorrect states are never colour-only
      (they carry a tick/cross and text).
- [ ] **Back button** — mid-test, after submitting, and after checkout. Nothing
      double-charges or resurrects a submitted test.
- [ ] **Two tabs** — open the same tutor session twice and answer the same
      question in both. The first grade wins; the second tab reports the stored
      result rather than overwriting it.
- [ ] **Direct URL access** — as the student, try `/admin` (→ dashboard), `/org`
      (→ dashboard), and another user's `/tests/<id>/results` (→ 404).

---

## 13. Known gaps — not bugs

Don't log these:

- No transactional email (receipts, assignment reminders, readiness alerts).
  Only auth emails exist.
- No admin analytics dashboard, no admin payments view.
- `/api/paypal/webhook` and `/api/cron/reconcile` return **503** locally by
  design (unset secrets).
- Org invites are copy-link, not emailed, for accounts that already exist.
- No platform-wide audit UI; `audit_logs` is written but only surfaced
  org-scoped at `/org/audit`.
- The new-test wizard shows no Exam step — there is only one seeded exam.
- Readiness for members outside an org isn't shown (the score's inputs are org
  settings).

---

## 14. Reporting a bug

```
**What I did**      (exact URL + steps)
**Expected**
**Actually happened**
**Account**         (which persona, trial/paid/org-admin/admin)
**Environment**     browser + desktop/mobile, dark/light
**Evidence**        screenshot; console + network errors if any
```

Please note whether the database was freshly reset — several behaviours depend
on how much practice history exists.

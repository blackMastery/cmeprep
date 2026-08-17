---
name: review-heuristics
description: cmeprep-specific review heuristics — bug classes that recur and codebase norms that are NOT findings
metadata:
  type: project
---

Review heuristics learned on this codebase (study-plan review, 2026-08-16).

**Bug class that produced real Criticals: generation-time clamps vs evaluation-time
thresholds.** This codebase freezes prescriptions (assignment configs, plan-week
docs) and evaluates completion later against module-level constants. When
generation clamps a target to available content (bank size) but evaluation
compares against a fixed constant (SESSION_MIN_ATTEMPTS, MOCK_MIN_QUESTIONS),
small banks make goals permanently unmeetable. Whenever a `-core` module both
generates and evaluates, cross-check every evaluation threshold against the
smallest value generation can prescribe.
**How to apply:** in any diff touching a `-core` file with both a generator and
an evaluator, tabulate min-prescribable vs required-threshold per goal/config type.

**Supabase redirect allow-list is exact-match including the query string**
(config.toml:181-187 documents this for /auth/confirm). Any redirect_to built
with a *dynamic* query param (e.g. `?next=<user path>`) can never be enumerated
in the allow-list, so GoTrue silently falls back to site_url and the auth code
lands on a page that never exchanges it → sign-in silently fails. Fix pattern:
carry the dynamic state in a short-lived cookie set by the server action and
read+cleared in the callback route, keeping redirect_to static.
**How to apply:** in any diff passing `redirectTo`/`emailRedirectTo`, check the
URL is byte-identical to an allow-list entry for every reachable input.

**OFFSET paging must order by a unique key.** Precedent: lib/orgs.ts pages with
`.order("id")` / `.order("user_id")` (unique per row). New paging loops that
order by a non-unique column (e.g. `test_id` on a per-(test,subject) view, or
`created_at` in lib/admin/osce.ts listGradingEvents) can skip/duplicate rows
across `.range()` pages. Recurred in the OSCE review (2026-08-17).

**Count views count ALL published question types.** `exam_subject_counts` and
`subject_question_counts` have no `type` filter, but launch paths now filter
by type (`.eq/.neq("type","osce")` in POST /api/tests). Any feature that
prescribes a session size from a count view and then launches through a
type-filtered draw can prescribe more than the draw can deliver — this is how
the generation-clamp bug class re-fired when OSCE landed (plan-core
questionsPerSession clamped to an OSCE-inflated bank). When a new question
type or launch filter appears, re-audit every count-view consumer
(plan.ts, stats.ts, orgs.ts readiness, catalog.ts wizard counts).

**Norms that are NOT findings here (don't false-positive):**
- Destructuring `{ data }` and ignoring `error` is the pervasive local style for
  reads that fail soft. Only flag it when a null `data` then flows through a
  non-null `as` cast or property access on the happy path (crash instead of
  handled state).
- Admin-client queries with `.eq("user_id", caller.id)` / `.in()` as the
  ownership wall are sanctioned when commented as such (CLAUDE.md pattern).
- `security_invoker = true` views joining attempts/questions/subjects/
  specialties granted to `authenticated` are the established readiness pattern
  (20260817000001) — underlying grants exist.
- Server-supplied prescriptions (`assignmentId`, `planWeekId` bodies to
  POST /api/tests) still flow through the shared entitlement + subject-integrity
  + trial-quota pipeline lower in the route; verify the merge point
  (`assignment ? … : (planPrescription ?? parsed!.data)`) rather than assuming
  the branch skips checks.
- attempts are unique on (test_id, question_id) — max attempts a test can put
  into a subject = distinct questions from that subject in the paper. Load-
  bearing for any per-session threshold math.
- OSCE security posture (20260822000002): `question_model_answers` is a
  hard-revoked service-role-only table (NOT a questions column); the grade
  route's `mode === 'osce'` + link + `type === 'osce'` gates and
  loadOsceRevealData's mode gate are the sanctioned mid-test correctness
  boundary, same standing as the tutor reveal route. Attempts-first-then-lock
  ordering in the grade route is deliberate (a locked station must always
  have a verdict; the reverse crash window costs only a re-grade).
- Pure `-core` modules (analytics-core, orgs-core, osce-grading-core) are
  deliberately client-importable — a runner importing constants from them is
  fine, not a server-boundary finding. analytics-core contains a literal NUL
  byte (revenue keyId join separator), so git shows it as binary; use
  `git diff --text` on it.

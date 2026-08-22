# Question reports

Students can tell us a question is broken; admins triage and fix it.

Today the only student→admin content channel is OSCE grade disputes
(`osce_grade_reports` → `/admin/osce/reports`). For the MCQ bank — a wrong
answer key, a typo, an outdated guideline — a student has no way to tell us
and we have no way to find out. `test_answers.flagged` looks like this but
isn't: it is a private "come back to this" bookmark and no admin surface
reads it.

## 1. Scope

**MCQ only** (`mcq_single`, `mcq_multi`). OSCE stations keep their existing
"Report this grade" and are deliberately NOT given a second control — one
report affordance per station. The two queues stay separate and cross-link:
a grade dispute sends you to the judge log and model answer, a question
report sends you to the answer key.

## 2. The student side

### Entry points

Four, all posting to the same endpoint:

| Where | Control |
| --- | --- |
| Mid-test (`/tests/[id]/take`) | one tap, no dialog |
| Review (`/tests/[id]/review`) | full dialog |
| Tutor mode, after the reveal | full dialog |
| `/bookmarks` | full dialog |

### Mid-test is one tap, never a dialog

The clock does not stop — pausing for a report would be a thinking-time
exploit. So mid-test the control is a **single silent tap** that files the
report immediately with no category and no note, and it **toggles** while the
test is `in_progress` so a mis-tap can be undone. After submit it is final.

It is deliberately unlike "flag for review", which sits next to it: the review
flag keeps its palette placement and keyboard shortcut; **"Report a problem"
is a small text link under the stem**, with no shortcut. Different shape,
different place, different weight.

### Elaboration at results

The results page shows one compact, skippable block listing the questions
flagged during that test, each with a category picker and optional note.
**Skipping costs nothing** — the bare reports are already filed. A question
carrying 30 bare flags is still obviously broken.

### What the student sees afterwards

Persistent `You reported this` wherever they meet that question again, for as
long as their report is open. Once we resolve it, the control returns to
`Report a problem` — see re-reporting below.

### Report shape

Category (required outside mid-test) + optional note:
`wrong_key` · `typo` · `outdated` · `ambiguous` · `image` · `other`.

### Limits

- **One OPEN report per user per question.** A duplicate while open is
  answered as success — their goal (it's flagged) is already met.
- Resolving reopens the channel: a complaint about the *fixed* version is new
  information, and permanently silencing a reporter would hide a bad fix.
- **20 reports per user per day.**
- The question must be one the user has actually met (a test of theirs, or a
  bookmark) — ids are not enumerable into the queue.

## 3. The admin side

`/admin/questions/reports`, and `/org/content/reports` for org banks.

### Rollup, not a report feed

One row per reported question, count and notes nested. Resolving resolves the
QUESTION, closing every open report on it at once. 41 students hitting one
broken question is 1 row of work, not 41.

### Ranking

By **rate** (distinct reporters ÷ attempts), with a floor of **5 distinct
reporters**; below the floor, rank by reporter count. Both numbers always
shown. Rate-ranking is what surfaces a freshly-imported broken question —
8 reporters in 20 sittings — above a long-lived question with 15 in 5,000.

Attempts are counted **live** for the reported questions only (a small set,
covered by `attempts_question_idx`). `analytics_question_stats` is not used
here: it is recomputed nightly, so a question imported today would rank on
`attempts_count = 0`, which is exactly the case this ranking exists to catch.

### Evidence on the row

Stem, options, the key, the explanation — plus **what everyone actually
picked**, from `attempts.selected_option_ids`, **split at the question's last
edit**:

```
Since last edit (22 Aug) · 84        Before the edit · 1,204
  C ✓ ████████████ 79%  ← key          B ████████████ 71%
  B ███            9%                  C ✓ ███        18%
```

All-time alone would make a corrected question look permanently broken. The
split is how you see a fix land.

Reporters are **identified** (email against each note), as the OSCE queue
already does — you need it to spot a serial reporter and to follow up on a
genuinely good catch.

### Resolution

An outcome, not just a timestamp: `fixed` · `no_change` · `not_actionable`,
plus an optional note.

`no_change` is the valuable one. When the same question is reported again the
rollup **reopens carrying that ruling forward**, so you re-examine rather than
re-derive — and a wrong "no change" can still be corrected when 40 more people
disagree.

### Closing the loop from the editor

Saving a question that has open reports offers `Resolve as Fixed?` — offered,
never assumed. Auto-resolving on save would silently close 41 "the key is
wrong" reports when all you fixed was a comma.

### Lifecycle

- **Soft-deleting** a question auto-resolves its reports as `not_actionable`
  — it can't be fixed, and it would sit at the top of a rate-ranked queue.
- **Unpublishing** does NOT: you are usually mid-fix, and the notes are the
  spec for that fix.
- Nothing is ever deleted. The queue defaults to open; resolved rows stay
  queryable, and the question editor shows that question's full history.
  The reopen rule depends on that memory.

### Never automatic

Reports never change what students see. No threshold unpublishes anything —
that would hand a cohort a mechanism for voting a hard-but-correct question
out of the bank. The OSCE precedent, stated the same way: the verdict stands
until a human moves it.

### Org scoping

Org admins see, resolve and fix reports on **their own** bank (they already
author it via `/org/content`); their resolutions audit under their org id.
Platform admins see everything. No org ever sees another org's reports or the
public bank's. Reuses `requireContentAuthor` / `questionInScope`.

### Notification

Its own badge on the **Questions** nav item — open rollup count. Kept apart
from the existing payments badge, which is money-ops with a different
urgency.

## 4. What does NOT change

`attempts` stays append-only and untouched. Fixing a key does not rescore,
void, or rewrite history: those rows drive accuracy, weak areas, streaks,
readiness and org dashboards, and numbers people already saw must not move
under them. A student marked wrong by a broken key stays marked wrong —
stated plainly here because it is a real cost, knowingly accepted.

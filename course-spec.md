# Courses — Feature Specification

Admin-authored courses: structured learning content (video, image, text/markdown,
PDF) organized into modules, with auto-graded quizzes that gate progression.
Free for all signed-in users. This document is the source of truth for v1;
decisions below were confirmed with the product owner on 2026-08-16.

## 1. Summary of decisions

| Area | Decision |
| --- | --- |
| Access | Free for every signed-in user — no entitlement/subscription gate |
| Taxonomy | Standalone catalog; **not** attached to exams/specialties/subjects |
| Structure | Course → ordered modules → ordered lessons; one content item per lesson |
| Content types | `video`, `image`, `text` (markdown), `pdf`, `quiz` — **no PPT** (deliberately dropped; upload UI tells admins to export decks as PDF) |
| Progression | Quiz-gated: lessons freely navigable inside unlocked modules; a module's quizzes must be passed before the next module unlocks (server-enforced) |
| Quiz engine | Separate course-quiz tables — never touches the exam question bank, `attempts`, accuracy or streak stats |
| Quiz rules | Admin-set pass threshold (default 70%), unlimited immediate retakes, any passing attempt unlocks |
| Quiz format | Single-best-answer MCQ only (2–8 options, exactly one correct) |
| Quiz UX | All questions on one page, one submit, instant score + per-question feedback + explanations. No timer, no palette |
| Non-quiz completion | Explicit "Mark complete" button on every content lesson |
| Video hosting | Supabase Storage, direct MP4 upload (H.264); no transcoding — policy is "upload web-ready MP4" |
| Upload path | Direct-to-storage signed upload URLs (browser → bucket); files never pass through Next |
| File security | Private bucket; all reads via short-lived signed URLs minted server-side after auth |
| File caps | Video ≤ 500 MB (mp4), PDF ≤ 50 MB, images ≤ 10 MB (jpg/png/webp) |
| Publishing | `draft` / `published`; published courses are edited in place (no versioning/snapshots) |
| Text authoring | Markdown textarea + live preview; rendered sanitized (no raw HTML pass-through) |
| Org features | None in v1 — no assignment, no manager visibility |
| Completion reward | Completed state + progress surfacing on dashboard; no certificate |
| Discovery | "Courses" app-nav item with a catalog page + dashboard "continue learning" card |

## 2. Data model

New tables (one migration + grants file; update `lib/supabase/types.ts` in the
same change — it is hand-maintained).

```
courses
  id            uuid pk default gen_random_uuid()
  title         text not null
  description   text not null default ''
  cover_path    text          -- storage object path, nullable
  status        text not null default 'draft' check (status in ('draft','published'))
  created_by    uuid not null references profiles(id)
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()
  deleted_at    timestamptz   -- soft delete, matches admin convention

course_modules
  id            uuid pk
  course_id     uuid not null references courses(id)
  title         text not null
  position      int  not null            -- unique (course_id, position) deferrable
  created_at / updated_at / deleted_at

course_lessons
  id            uuid pk
  module_id     uuid not null references course_modules(id)
  title         text not null
  kind          text not null check (kind in ('video','image','text','pdf','quiz'))
  position      int  not null            -- unique (module_id, position) deferrable
  body_md       text                     -- kind='text': the content; other kinds: optional intro text above the media
  file_path     text                     -- storage object path for video/image/pdf
  file_size     bigint                   -- recorded at upload-confirm time
  pass_pct      int                      -- kind='quiz' only; 1–100, default 70
  created_at / updated_at / deleted_at

course_questions                          -- quiz lessons only
  id            uuid pk
  lesson_id     uuid not null references course_lessons(id)
  prompt_md     text not null
  explanation_md text not null default ''
  position      int  not null
  created_at / updated_at / deleted_at

course_question_options
  id            uuid pk
  question_id   uuid not null references course_questions(id)
  label         text not null
  is_correct    boolean not null default false
  position      int  not null
  -- exactly one is_correct per question, enforced in the action layer (single-best-answer v1)

course_lesson_progress                    -- one row per (user, lesson) when completed
  user_id       uuid not null references profiles(id)
  lesson_id     uuid not null references course_lessons(id)
  completed_at  timestamptz not null default now()
  primary key (user_id, lesson_id)

course_quiz_attempts                      -- immutable, append-only
  id            uuid pk
  user_id       uuid not null
  lesson_id     uuid not null references course_lessons(id)
  score_pct     int  not null
  passed        boolean not null
  answers       jsonb not null           -- [{question_id, option_id, correct}]
  created_at    timestamptz not null default now()
```

Notes:

- **Quiz completion** is derived: a quiz lesson is complete for a user when a
  `course_quiz_attempts` row with `passed = true` exists. Passing also inserts
  the `course_lesson_progress` row so completion queries stay uniform.
- **Module unlock rule** (the one rule, stated once, in a `-core` module):
  module N is unlocked iff every *quiz* lesson in modules 1..N-1 (published,
  not soft-deleted) has a passing attempt. Content lessons never lock anything.
  Module 1 is always unlocked.
- **Course completion** is derived: every non-deleted lesson in every
  non-deleted module has a progress row. Edit-in-place means adding a lesson
  can un-complete a course and deleting one can complete it — accepted;
  recompute on read, never store a completed flag.
- `position` gaps are fine; ordering is `order by position, id`. Reordering
  rewrites positions inside a transaction.

### Correctness isolation

`course_question_options.is_correct` must never reach the browser before a
submitted attempt. Mirror the exam-engine pattern:

- Revoke client-role access to `course_question_options`; expose a
  `course_question_options_public` view (id, question_id, label, position).
- Only the quiz-grading server code reads `is_correct`.
- Feedback (correct answers + explanations) is served only as part of a graded
  attempt response — which is always allowed here, since retakes are unlimited
  and the quiz is formative. There is no "in progress" state to protect: an
  attempt is created already-graded in one server round trip.

### RLS / grants

- `courses`, `course_modules`, `course_lessons`, `course_questions` (minus
  options), `course_question_options_public`: `select` for `authenticated`
  where the course is `published` and not deleted. Draft content is invisible
  to non-admins even with a direct query.
- `course_lesson_progress`, `course_quiz_attempts`: `select`/`insert` own rows
  only (`user_id = auth.uid()`); no update/delete. Inserts for quiz attempts
  happen server-side anyway (grading), but RLS is the backstop.
- All admin writes go through `createAdminClient()` after `requireAdmin()`.
- New tables need explicit grants (see existing `..._grants.sql` files) or
  every query fails with "permission denied".

## 3. Storage

One new **private** bucket: `course-content`.

- Object paths: `courses/{courseId}/cover.{ext}`,
  `courses/{courseId}/lessons/{lessonId}/{uuid}.{ext}`.
- **Upload** (admin): server action verifies `requireAdmin()`, validates
  declared mime + size against the caps, then returns a
  `createSignedUploadUrl` token. Browser uploads directly to storage
  (TUS/resumable for video). A confirm action then stamps
  `file_path`/`file_size` on the lesson — a lesson only references files whose
  upload was confirmed.
- **Read** (learner): no dedicated file route — the lesson page is a Server
  Component that already runs `requireUser()` + the unlock check, so it mints
  the short-lived signed URL during render (`getLessonView` in
  `lib/courses.ts`): ~2h for video so seeking keeps working, ~15min for
  images/PDF. Locked/hidden lessons never get a URL. Covers use ~1h signed
  URLs batch-minted in the catalog query. (Implementation deviation from the
  original route-handler plan: identical checks, one less moving part.)
- Caps enforced twice: in the action (reject before signing) and as bucket
  file-size limit / allowed-mime configuration.
- Accepted mimes: `video/mp4`; `image/jpeg`, `image/png`, `image/webp`;
  `application/pdf`.
- Deleting a lesson/course soft-deletes rows; storage objects are left in
  place (cheap, reversible). A later cleanup job can hard-delete objects for
  rows soft-deleted > 90 days — out of scope for v1.

## 4. Module structure in `lib/`

Follow the `-core` / server split:

- `lib/courses-core.ts` — pure, unit-tested: unlock computation, completion %
  derivation, quiz grading (score %, pass/fail against threshold), ordering
  helpers, upload-cap validation. Single-best-answer grading is trivial but
  still lives here so the pass-threshold rule is stated once.
- `lib/courses.ts` — `server-only`: catalog queries, take-state assembly
  (course + modules + lessons + user progress + unlock flags), progress writes.
- `lib/admin/courses.ts` — `server-only`: builder CRUD, signed-upload issuing,
  all wrapped in `audit()` with typed action names (`course.create`,
  `course.publish`, `course.lesson.reorder`, …). Bulk reorder = one audit row.
- Validation schemas in `lib/validation.ts` (zod, `uuid()` convention).

## 5. Learner experience

### Routes

- `/cme` — catalog: published courses as cards (cover, title, description,
  progress bar or "Completed" badge). Empty state if none published.
- `/cme/[id]` — course overview: description + syllabus (modules with
  lessons, per-lesson completion checkmarks, locked modules shown with a lock
  and "Pass the Module N quiz to unlock"). Continue button jumps to the first
  incomplete lesson in the furthest unlocked module.
- `/cme/[id]/lessons/[lessonId]` — the lesson player page:
  - Persistent syllabus sidebar (collapsible on mobile) for navigation.
  - Content area by kind:
    - `video`: `<video controls>` with signed src; poster from cover.
    - `image`: figure with signed src, `body_md` below.
    - `text`: rendered markdown.
    - `pdf`: inline `<iframe>` viewer with a download link fallback.
    - `quiz`: see below.
  - "Mark complete" button (content kinds) → server action inserts progress
    row, button flips to "Completed ✓". Idempotent; un-marking is not
    supported in v1.
  - Prev/next lesson links; next is disabled when it crosses into a locked
    module.

Both the lesson page (Server Component) and every action/route re-check the
unlock rule server-side — navigation guards in the UI are cosmetic only. A
direct request for a locked lesson renders a locked notice (no content, no
signed URL, no quiz questions).

### Quiz taking

- All questions rendered on one page from the public options view, in stored
  order (no shuffling in v1 — formative, retakeable).
- Submit → server action grades against `is_correct` server-side, writes an
  immutable `course_quiz_attempts` row, and (on pass) the progress row.
- Response renders: score %, pass/fail banner, and per-question feedback —
  learner's pick, correct answer, explanation markdown.
- Fail → "Retake quiz" resets the form. Unlimited attempts, no cooldown.
- Attempt history (date, score) listed under the quiz for the learner.

### Dashboard

- "Continue learning" card: most recently active in-progress course
  (progress bar + resume link). Hidden when no courses started. Completed
  count can join existing dashboard stats.

## 6. Admin experience

### Routes (under `app/admin/`, covered by `requireAdmin()` layout)

- `/admin/courses` — list (status chip, lesson count, updated at; soft-deleted
  hidden behind a filter). "New course" creates a draft with just a title.
- `/admin/courses/[id]` — the builder, one page:
  - Course meta panel: title, description (markdown), cover upload,
    publish/unpublish, soft delete.
  - Module list with add/rename/delete/reorder (drag or up/down buttons —
    up/down is fine for v1).
  - Lessons under each module: add picks a kind first; each lesson row edits
    inline or in a sheet: title, `body_md` (textarea + preview tab), file
    upload with progress bar (direct-to-storage), replace-file.
  - Quiz lesson editor: pass threshold, question list; per question: prompt
    (markdown), 2–8 options, exactly-one-correct radio, explanation
    (markdown). Server action validates the exactly-one-correct invariant.
- Publish validation: a course can only be published when it has ≥1 module,
  every module has ≥1 lesson, every quiz has ≥1 question, every question has
  ≥2 options with exactly one correct, and every video/image/pdf lesson has a
  confirmed file. Unpublish is always allowed (learners' progress is kept).
- Draft preview: admins open the learner routes directly — learner queries
  allow `status='draft'` when the viewer is an admin.

### Edit-in-place semantics (published courses)

- Everything stays editable after publish. Consequences, accepted knowingly:
  - Deleting a lesson deletes it from everyone's syllabus; existing progress
    rows for it are ignored by completion math (they filter on non-deleted
    lessons).
  - Adding a lesson/quiz lowers everyone's completion %; adding a quiz to an
    early module can re-lock later modules for learners who were past it.
    Their existing progress is untouched and re-unlocks on passing.
  - Editing a question after attempts exist does not rewrite history —
    attempts store the graded snapshot in `answers` jsonb.
- The builder shows a subtle "This course is live — changes appear to
  learners immediately" banner when editing a published course.

## 7. Edge cases & failure modes

- **Orphaned uploads**: file uploaded but confirm never ran (tab closed) —
  object exists with no row. Harmless; covered by the future cleanup job.
- **Upload replaced**: replacing a lesson's file re-points `file_path`; the
  old object is left (same cleanup story).
- **Signed URL expiry mid-video**: 2h expiry chosen to exceed any plausible
  viewing session; the player does not need refresh logic in v1.
- **Concurrent admin edits**: last-write-wins, same as the rest of admin. No
  locking in v1.
- **Locked-module probing**: direct lesson URL, file route, and quiz-submit
  action all recompute the unlock rule; RLS additionally hides draft courses.
  A learner can read module/lesson *titles* of locked modules (syllabus shows
  them) — content and files are what's protected.
- **Quiz with zero questions on a published course**: prevented by publish
  validation; if it happens anyway (post-publish deletion of all questions),
  grading treats it as un-passable and the builder flags it — admin must fix.
- **Markdown safety**: render with a sanitizing pipeline (no raw HTML).
  Applies to learner-facing prompt/explanation/body rendering and admin
  preview alike.
- **Mobile video**: no transcoding means an oversized 4K upload plays poorly;
  the uploader UI states "1080p H.264 MP4 recommended". Policy, not code.
- **Storage growth**: modest caps + admin-only uploads keep this bounded;
  monitor bucket size manually for now.

## 8. Explicitly out of scope for v1

- PPT/PPTX in any form (dropped — admins export decks to PDF).
- Video transcoding/adaptive streaming, watch-percentage tracking.
- Selling courses, entitlement gating, exam/taxonomy attachment.
- Org assignment, manager visibility, due dates, readiness integration.
- Certificates or CME credit claims.
- Course versioning/snapshots, multi-block composite lessons.
- Multi-select questions, shuffling, timed quizzes, attempt limits.
- Comments, ratings, search/filtering of the catalog.
- Storage garbage collection (cleanup job noted in §3).

## 9. Implementation order

1. Migration + grants + RLS + `types.ts` update (all tables, views, bucket).
2. `lib/courses-core.ts` + vitest coverage (unlock rule, completion math,
   grading, cap validation, publish validation).
3. Admin builder: CRUD actions with `audit()`, direct-to-storage upload flow,
   quiz editor, publish validation.
4. Learner routes: catalog → overview → lesson player, file route with signed
   URLs, mark-complete action.
5. Quiz taking: public options view wiring, grading action, results render,
   attempt history.
6. Dashboard card + nav item; empty states; `npx next typegen` after route
   additions.
7. Lint, typecheck, vitest — the whole gate (no CI/e2e).

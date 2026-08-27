/**
 * Database types for CME Prep.
 *
 * Hand-maintained to match supabase/migrations/*.sql. Once a Supabase project
 * is linked you can regenerate with:
 *   npx supabase gen types typescript --local > lib/supabase/types.ts
 */

export type UserRole = "trial" | "student" | "admin";
export type QuestionType = "mcq_single" | "mcq_multi" | "image_based" | "osce";
export type Difficulty = "easy" | "medium" | "hard";
export type TestStatus = "in_progress" | "submitted" | "abandoned";
/** text + check constraint in Postgres, NOT a pg enum (payments precedent).
 * 'osce' sessions are untimed like tutor (expires_at CHECK-constrained null). */
export type TestMode = "exam" | "tutor" | "osce";
export type SubStatus = "active" | "expired" | "cancelled";

export type TestConfig = {
  subject_ids: string[];
  difficulty: Difficulty | "mixed";
  num_questions: number;
  /** Absent on tutor tests — they are untimed. */
  duration_sec?: number;
  /** Absent on tests created before the exam level existed. */
  exam_id?: string;
  /**
   * Assignment-prescription input ONLY (org_assignments.config): the launch
   * route reads it as the org's default mode and never copies it onto the
   * test row — tests.mode (the column) is the single source of truth there.
   * Narrower than TestMode: assignments can't prescribe OSCE sessions
   * (assignmentModeSchema pins this).
   */
  mode?: "exam" | "tutor";
};

type Timestamps = { created_at: string };

export type Profile = Timestamps & {
  id: string;
  full_name: string | null;
  /** Professional name printed on CME certificates. Deliberately separate
   * from full_name, which feeds greetings through lib/names.ts firstName(). */
  credential_name: string | null;
  role: UserRole;
  trials_used: number;
  trials_limit: number;
  banned_at: string | null;
  updated_at: string | null;
};

export type Exam = Timestamps & {
  id: string;
  name: string;
  code: string | null;
  position: number;
  /** Offered at checkout. False still serves everyone who already bought it. */
  is_active: boolean;
  /** Private bank owner; null = public catalog. Never sold, never cross-org. */
  org_id: string | null;
};

export type Specialty = Timestamps & {
  id: string;
  exam_id: string;
  name: string;
  position: number;
};

/**
 * One admin-uploaded document filed under an exam — syllabus, blueprint, or
 * related reference material. Deny-all to client roles: reading one is a PAID
 * benefit, and that rule lives in lib/entitlements-core.ts, not in RLS.
 */
export type ExamDocument = Timestamps & {
  id: string;
  exam_id: string;
  title: string;
  description: string;
  /** Object path in the exam-documents bucket (private, signed URLs). */
  file_path: string;
  /** Original filename — the `download` name on the signed URL. */
  file_name: string;
  file_size: number;
  content_type: string;
  position: number;
  is_published: boolean;
  created_by: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type Subject = Timestamps & {
  id: string;
  specialty_id: string;
  name: string;
  position: number;
};

export type Question = Timestamps & {
  id: string;
  subject_id: string;
  type: QuestionType;
  difficulty: Difficulty;
  stem: string;
  image_path: string | null;
  explanation: string;
  is_published: boolean;
  deleted_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  /** Stamped only on CONTENT edits (stem/options/explanation/image) — the
   * question-report pick split's boundary. updated_at moves on publish
   * toggles too and would wipe the evidence that a fix landed. */
  content_updated_at: string | null;
};

export type QuestionOption = Timestamps & {
  id: string;
  question_id: string;
  label: string;
  is_correct: boolean;
  position: number;
  /** Retired options stay readable so historical papers still resolve. */
  deleted_at: string | null;
};

/** Client-safe option shape — deliberately has no `is_correct`. */
export type QuestionOptionPublic = {
  id: string;
  question_id: string;
  label: string;
  position: number;
};

/** OSCE answer key. Service-role only (question rows are client-readable, so
 * this can NOT live as a column on questions without leaking mid-test). */
export type QuestionModelAnswer = {
  question_id: string;
  model_answer: string;
  updated_at: string;
};

export type Test = Timestamps & {
  id: string;
  user_id: string;
  status: TestStatus;
  mode: TestMode;
  config: TestConfig;
  started_at: string;
  /** Null exactly when mode='tutor' (CHECK-constrained) — tutor sessions
   * never expire and stay resumable indefinitely. */
  expires_at: string | null;
  submitted_at: string | null;
  /** % of total_questions for exam mode; % of answered_questions for tutor. */
  score: number | null;
  total_questions: number;
  /** Written at finalize (both modes); null while in progress / legacy rows.
   * Completion % = answered_questions / total_questions. */
  answered_questions: number | null;
  /** Launched from an org assignment; completion tracking keys off this. */
  assignment_id: string | null;
};

export type TestQuestion = {
  test_id: string;
  question_id: string;
  position: number;
  option_order: string[];
};

export type TestAnswer = {
  test_id: string;
  question_id: string;
  selected_option_ids: string[];
  /** OSCE only: the staged free-text answer. Null on MCQ rows. */
  answer_text: string | null;
  flagged: boolean;
  time_spent_sec: number;
  /** Tutor/OSCE only: set once by the reveal/grade endpoint, never cleared.
   * A revealed answer is locked — the answers PATCH skips these rows. */
  revealed_at: string | null;
  updated_at: string;
};

export type Attempt = {
  id: string;
  test_id: string | null;
  user_id: string;
  question_id: string;
  selected_option_ids: string[];
  /** OSCE only: the graded free-text answer, immutable like the verdict.
   * Review reads this (never test_answers). Null on MCQ rows. */
  answer_text: string | null;
  is_correct: boolean;
  time_spent_sec: number | null;
  answered_at: string;
};

export type Bookmark = Timestamps & {
  user_id: string;
  question_id: string;
};

export type Note = Timestamps & {
  user_id: string;
  question_id: string;
  body: string;
  updated_at: string | null;
};

export type AuditLog = {
  id: number;
  actor_id: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  /** Set on org-admin actions; the org audit page filters on it. */
  org_id: string | null;
  created_at: string;
};

export type UserStats = {
  user_id: string;
  attempted: number;
  correct: number;
  accuracy_pct: number;
};

export type SubjectAccuracy = {
  user_id: string;
  subject_id: string;
  subject_name: string;
  specialty_id: string;
  specialty_name: string;
  exam_id: string;
  exam_name: string;
  attempts: number;
  correct: number;
  accuracy_pct: number;
};

export type UserDailyActivity = {
  user_id: string;
  day: string;
};

/** Exam vs tutor accuracy split; legacy null-test_id attempts count as exam. */
export type UserModeStats = {
  user_id: string;
  mode: TestMode;
  attempted: number;
  correct: number;
  accuracy_pct: number;
};

/* Readiness views (20260817000001): callers MUST filter on the GROUP BY
 * columns — an unfiltered select aggregates the whole attempts table. */

/** Per-user per-exam ISO-week (Mon, America/Guyana) accuracy split by mode. */
export type UserExamWeeklyModeAccuracy = {
  user_id: string;
  exam_id: string;
  /** date (YYYY-MM-DD), Monday of the ISO week in America/Guyana. */
  week_start: string;
  mode: TestMode;
  attempts: number;
  correct: number;
  time_spent_sec: number;
  /** Attempts that carried a non-null time_spent_sec (pacing denominator). */
  timed_attempts: number;
};

/** Per-user per-exam ISO-week distinct active days (deduped across modes). */
export type UserExamWeeklyActivity = {
  user_id: string;
  exam_id: string;
  week_start: string;
  active_days: number;
};

/** Per-user per-exam all-time totals + last active day. */
export type UserExamStats = {
  user_id: string;
  exam_id: string;
  attempts: number;
  correct: number;
  /** date (YYYY-MM-DD) in America/Guyana. */
  last_active_day: string;
};

/** Every subject of an exam with its published question count. */
export type ExamSubjectCounts = {
  exam_id: string;
  subject_id: string;
  subject_name: string;
  /** All published questions, OSCE included — the coverage denominator. */
  question_count: number;
  /** Excludes OSCE — what an exam/tutor launch can actually deal. Plan
   * generation and mock rosters MUST size against this one. */
  mcq_question_count: number;
};

/** Published, non-deleted, non-OSCE questions per subject — the buyer-facing
 * count of the MCQ bank (OSCE stations count separately, see
 * subject_osce_question_counts). */
export type SubjectQuestionCount = {
  subject_id: string;
  question_count: number;
};

export type Subscription = Timestamps & {
  id: string;
  user_id: string;
  paypal_subscription_id: string | null;
  /** Free text snapshot; presets come from the plans table. */
  plan: string;
  /** Soft link to plans; null for bespoke admin grants and deleted plans. */
  plan_id: string | null;
  /**
   * Exam this subscription entitles.
   * null = ALL-ACCESS (grandfathered legacy rows + admin comp grants).
   */
  exam_id: string | null;
  status: SubStatus;
  current_period_end: string;
  updated_at: string | null;
};

/** PayPal webhook deliveries — unique event id is the idempotency key. */
export type PaymentEvent = {
  id: string;
  paypal_event_id: string;
  type: string;
  payload: Record<string, unknown>;
  /** Null = the handler threw; the reconciliation sweep replays these. */
  processed_at: string | null;
  /** At MAX_REPLAY_ATTEMPTS the row is quarantined, not retried. */
  replay_attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type PaymentStatus =
  | "captured"
  | "partially_refunded"
  | "refunded"
  | "denied"
  | "reversed";

/** Which code path wrote the row; 'backfill' = reconstructed from payment_events. */
export type PaymentSource =
  | "capture_route"
  | "webhook_capture"
  | "webhook_approved"
  | "reconcile"
  | "backfill";

/** Why a captured payment never became a subscription. */
export type PaymentGrantFailure =
  | "unknown_user"
  | "unknown_plan"
  | "no_duration"
  | "unknown_exam"
  | "unknown_org"
  | "insert_failed";

/**
 * One captured PayPal ORDER. Written by both grant paths BEFORE the grant is
 * attempted, so `subscription_id === null` means money with nothing behind it.
 *
 * status/source/grant_failure are text + check constraints, NOT pg enums — they
 * are deliberately absent from Database["public"]["Enums"] below.
 */
export type Payment = Timestamps & {
  id: string;
  /** Null only if the buyer's profile vanished; custom_id keeps the raw id. */
  user_id: string | null;
  /** Null = captured with no grant. See grant_failure. */
  subscription_id: string | null;
  /** Org bought for; null = personal purchase (or unresolved org). */
  org_id: string | null;
  /** The org-purchase side of "granted" — subscription_id stays null. */
  org_subscription_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  /** plans.price_cents AT capture time — the expected side of the amount check. */
  plan_price_cents: number | null;
  /**
   * Exam bought. null + grant_failure null = grandfathered all-access;
   * null + grant_failure set = unresolved, see custom_id.
   */
  exam_id: string | null;
  paypal_order_id: string;
  paypal_capture_id: string | null;
  /** The purchase unit's custom_id verbatim: "userId:planId:examId". */
  custom_id: string | null;
  /** What PayPal moved. Null when the capture carried no amount at all. */
  amount_cents: number | null;
  currency: string | null;
  /** Running total across partial refunds; status is derived from it. */
  refunded_cents: number;
  status: PaymentStatus;
  source: PaymentSource;
  grant_failure: PaymentGrantFailure | null;
  captured_at: string;
  updated_at: string | null;
};

/** Org-membership role. Lives on the membership row — NOT profiles.role —
 * so role never becomes a second source of entitlement truth. */
export type OrgMemberRole = "admin" | "member";

export type Org = Timestamps & {
  id: string;
  name: string;
  /** Storage object in the org-branding bucket. */
  logo_path: string | null;
  /** Risk flagging: rolling accuracy below this % flags a member. */
  pass_mark_pct: number;
  /** Risk flagging: no activity for this many days flags a member. */
  risk_inactivity_days: number;
  /** Accepted members + pending invites must stay within this. */
  seat_limit: number;
  /** Platform-admin kill switch; treated like a lapsed subscription. */
  suspended_at: string | null;
  created_by: string | null;
  updated_at: string | null;
};

/** Department/team label within an org. One per member in v1; deletes are
 * HARD (FKs SET NULL) — a null reference means "unassigned". */
export type OrgDepartment = {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string | null;
};

export type OrgMember = {
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  joined_at: string;
  department_id: string | null;
  /** When the CURRENT department_id was assigned — the completion-cohort
   * input (lib/orgs-core.ts). Meaningful only while department_id is set. */
  department_changed_at: string | null;
};

export type OrgInvite = {
  id: string;
  org_id: string;
  /** citext in Postgres — comparisons are case-insensitive. */
  email: string;
  role: OrgMemberRole;
  invited_by: string | null;
  /** Copied onto the membership at accept; null = join unassigned. */
  department_id: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** Org-level access period. Grants are read-time (lib/entitlements-core.ts):
 * no per-member subscriptions rows exist, this row IS the entitlement. */
export type OrgSubscription = Timestamps & {
  id: string;
  org_id: string;
  /** Soft link to plans; null for bespoke admin grants and deleted plans. */
  plan_id: string | null;
  /** Free text snapshot; presets come from the plans table. */
  plan: string;
  /**
   * Public exam this period buys; null = all-access comp grant (admin/manual
   * only), mirroring subscriptions.exam_id.
   */
  exam_id: string | null;
  status: SubStatus;
  current_period_end: string;
  /** Idempotency key for the PayPal race; null for admin grants. */
  paypal_order_id: string | null;
  updated_at: string | null;
};

export type OrgAssignmentAudience = "all" | "selected" | "department";

/** A prescribed test config + due date (SPEC §7). */
export type OrgAssignment = {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  /** TestConfig shape, stored verbatim — the launched test IS this. */
  config: TestConfig;
  due_at: string;
  audience: OrgAssignmentAudience;
  /** Set only when audience='department'. Null in that audience means the
   * department was hard-deleted — the assignment reaches nobody. */
  department_id: string | null;
  created_by: string | null;
  created_at: string;
  /** Optimistic-concurrency token for edits; equals created_at until the
   * first edit, which is how the member list knows to say "updated". */
  updated_at: string;
  deleted_at: string | null;
};

export type OrgAssignmentTarget = {
  assignment_id: string;
  user_id: string;
};

/** Optional sitting date per org per entitled exam. FRAMING ONLY — drives
 * days-remaining copy and sort priority, never the readiness score/bands. */
export type OrgExamDate = {
  org_id: string;
  exam_id: string;
  /** date (YYYY-MM-DD) */
  sitting_on: string;
  updated_at: string;
};

/* ── Courses (20260818000001) ─────────────────────────────── */

export type CourseStatus = "draft" | "published";
/** text + check constraint in Postgres, NOT a pg enum (payments precedent). */
export type CourseLessonKind = "video" | "image" | "text" | "pdf" | "quiz";

export type Course = Timestamps & {
  id: string;
  title: string;
  description: string;
  /** Storage object path in the course-content bucket (private, signed URLs). */
  cover_path: string | null;
  status: CourseStatus;
  created_by: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type CourseModule = Timestamps & {
  id: string;
  course_id: string;
  title: string;
  position: number;
  updated_at: string | null;
  deleted_at: string | null;
};

export type CourseLesson = Timestamps & {
  id: string;
  module_id: string;
  title: string;
  kind: CourseLessonKind;
  position: number;
  /** kind='text': the content; other kinds: optional intro above the media. */
  body_md: string | null;
  /** Non-null means the upload was confirmed — the object exists. */
  file_path: string | null;
  file_size: number | null;
  /** Quiz pass threshold (%); null on non-quiz kinds (CHECK-constrained). */
  pass_pct: number | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type CourseQuestion = Timestamps & {
  id: string;
  lesson_id: string;
  prompt_md: string;
  explanation_md: string;
  position: number;
  updated_at: string | null;
  deleted_at: string | null;
};

export type CourseQuestionOption = {
  id: string;
  question_id: string;
  label: string;
  is_correct: boolean;
  position: number;
  /** Retired options stay so attempt snapshots keep resolving. */
  deleted_at: string | null;
};

/** Client-safe option shape — deliberately has no `is_correct`. */
export type CourseQuestionOptionPublic = {
  id: string;
  question_id: string;
  label: string;
  position: number;
};

export type CourseLessonProgress = {
  user_id: string;
  lesson_id: string;
  completed_at: string;
};

/** One graded pick, snapshotted at attempt time — question edits never
 * rewrite history. */
export type CourseQuizAnswer = {
  question_id: string;
  option_id: string;
  correct: boolean;
};

export type CourseQuizAttempt = {
  id: string;
  user_id: string;
  lesson_id: string;
  score_pct: number;
  passed: boolean;
  answers: CourseQuizAnswer[];
  created_at: string;
};

/* ── CME certificates (20260823000001) ───────────────────── */

/**
 * Issued once per (user, course) and never mutated. course_title/lesson_count
 * are snapshots so a rename, unpublish or soft-delete cannot retract or alter
 * an issued certificate; the learner's NAME is NOT here — it is read live
 * from profiles.credential_name so corrections propagate.
 */
export type CourseCertificate = {
  id: string;
  user_id: string;
  course_id: string;
  /** Opaque public handle, CME-XXXXX-XXXXX. Never the row id. */
  code: string;
  course_title: string;
  /** Evidentiary snapshot; never printed on the certificate face. */
  lesson_count: number;
  issued_at: string;
  created_at: string;
};

/* ── Study plans (20260820000001) ─────────────────────────── */

/** text + check constraint in Postgres, NOT a pg enum (payments precedent). */
export type PlanIntensity = "light" | "standard" | "intense";

/** Per-user per-exam plan knobs. sitting_on null = inherit the org's
 * org_exam_dates row; the personal date is never surfaced to org admins. */
export type StudyPlanSettings = {
  user_id: string;
  exam_id: string;
  intensity: PlanIntensity;
  /** date (YYYY-MM-DD) */
  sitting_on: string | null;
  diagnostic_dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** One generated (and frozen) plan week. */
export type StudyPlanWeek = {
  id: string;
  user_id: string;
  exam_id: string;
  /** Monday of the ISO week (YYYY-MM-DD, America/Guyana). */
  week_start: string;
  /** Versioned doc — parse with planGoalsDocSchema, never trust as typed. */
  goals: unknown;
  /** Snapshot the week was generated under; settings changes don't rewrite. */
  intensity: PlanIntensity;
  generated_at: string;
};

/** Per-user per-exam ISO-week attempts per (test, subject) — the focus-
 * session grain. Filter on user_id/exam_id/week_start (PERF CONTRACT). */
export type UserExamWeekTestSubjectAttempts = {
  user_id: string;
  exam_id: string;
  week_start: string;
  subject_id: string;
  test_id: string;
  mode: TestMode;
  attempts: number;
};

/** Latest outcome per (user, question), published questions only — rows with
 * is_correct=false are the retry pool. Always filter eq user_id first. */
export type UserQuestionLatestOutcome = {
  user_id: string;
  exam_id: string;
  subject_id: string;
  question_id: string;
  is_correct: boolean;
  answered_at: string;
};

/** Which storefront sells the plan; the two never mix in one checkout. */
export type PlanKind = "personal" | "org";

export type Plan = Timestamps & {
  id: string;
  name: string;
  price_cents: number;
  period: string;
  description: string | null;
  features: string[];
  /** Months of access a grant defaults to; null = pick the date manually. */
  duration_months: number | null;
  featured: boolean;
  is_active: boolean;
  position: number;
  kind: PlanKind;
  /** Seats an org plan sells; null on personal plans. */
  seat_limit: number | null;
  updated_at: string | null;
};

/* ── Admin analytics rollups (20260819000001) ─────────────────
 * Derived data written by /api/cron/rollup (lib/analytics.ts); service-role
 * only. Key columns use text sentinels ('none'/'unknown') because they sit in
 * composite PKs, which cannot hold NULLs. */

export type AnalyticsRevenueChannel = "personal" | "org";

/** Gross revenue per day × breakdown key; whole days are recomputed. */
export type AnalyticsDailyRevenue = {
  day: string;
  exam_key: string;
  plan_key: string;
  channel: AnalyticsRevenueChannel;
  source: string;
  currency: string;
  payments_count: number;
  gross_cents: number;
  /** Captures that arrived with amount_cents null — data-quality alarm. */
  null_amounts: number;
  updated_at: string;
};

/** Refund deltas booked on the day they were OBSERVED — append-only. */
export type AnalyticsDailyRefund = {
  day: string;
  exam_key: string;
  plan_key: string;
  channel: AnalyticsRevenueChannel;
  source: string;
  currency: string;
  refunds_count: number;
  refund_cents: number;
  updated_at: string;
};

/** How much of a payment's refunded_cents has been booked into daily refunds. */
export type AnalyticsRefundMark = {
  payment_id: string;
  booked_refunded_cents: number;
  updated_at: string;
};

/** One row per user per active Guyana day (>=1 attempt) — WAU/MAU source. */
export type AnalyticsActiveUserDay = {
  day: string;
  user_id: string;
};

export type AnalyticsDailyEngagement = {
  day: string;
  dau: number;
  /** Trailing 7/30-day distinct users ending this day, stored as observed. */
  wau: number;
  mau: number;
  tests_started_exam: number;
  tests_started_tutor: number;
  tests_submitted_exam: number;
  tests_submitted_tutor: number;
  /** Abandoned + (exam only) expired that day; tutor never expires. */
  tests_ended_exam: number;
  tests_ended_tutor: number;
  attempts_count: number;
  correct_count: number;
  updated_at: string;
};

/** Platform accuracy per exam per day; exam via the question taxonomy. */
export type AnalyticsDailyExamActivity = {
  day: string;
  exam_key: string;
  attempts: number;
  correct: number;
  updated_at: string;
};

/** Per published question, fully recomputed nightly. Counts only — the
 * hard/easy/cold thresholds live in lib/analytics-core.ts. */
export type AnalyticsQuestionStat = {
  question_id: string;
  exam_id: string | null;
  subject_id: string;
  attempts_count: number;
  correct_count: number;
  last_attempted_at: string | null;
  computed_at: string;
};

/** Flattened SweepSummary, one row per reconcile sweep run. */
export type ReconcileRun = {
  id: string;
  ran_at: string;
  duration_ms: number;
  truncated: boolean;
  clean: boolean;
  events_scanned: number;
  events_repaired: number;
  events_failed: number;
  events_quarantined: number;
  payments_scanned: number;
  payments_repaired: number;
  payments_failed: number;
};

/** Rollup job state: 'backfill' cursor + 'last_nightly' summary. */
export type AnalyticsState = {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
};

/* ── OSCE grading (20260822000002) ─────────────────────────── */

/** One OpenAI judge call, including failures (verdict null + error set).
 * Service-role only. Doubles as the daily-cap counter (verdict-not-null rows
 * per Guyana day) and holds the raw AI output students never see. */
export type OsceGradingEvent = {
  id: string;
  user_id: string;
  /** SET NULL on test deletion — spend history outlives the test. */
  test_id: string | null;
  question_id: string;
  answer_text: string;
  /** Null = the call failed; see error. Failed calls don't burn cap. */
  verdict: "correct" | "incorrect" | null;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number;
  error: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: string;
};

/** "Report this grade" flag — admin triage signal, no regrade mechanics. */
export type OsceGradeReport = {
  id: string;
  user_id: string;
  test_id: string;
  question_id: string;
  grading_event_id: string | null;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
};

/** Student "this question is broken" signal (question-reports-spec.md).
 * One row per (user, question) while open; resolved rows are kept forever
 * and carry the ruling the next rollup reopens against. */
export type QuestionReportCategory =
  | "wrong_key"
  | "typo"
  | "outdated"
  | "ambiguous"
  | "image"
  | "other";
export type QuestionReportResolution = "fixed" | "no_change" | "not_actionable";
export type QuestionReport = {
  id: string;
  question_id: string;
  user_id: string;
  test_id: string | null;
  /** Null = bare mid-test tap, never elaborated. */
  category: QuestionReportCategory | null;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: QuestionReportResolution | null;
  resolution_note: string | null;
};

/** Published OSCE stations per subject — gates the wizard's OSCE mode. */
export type SubjectOsceQuestionCount = {
  subject_id: string;
  question_count: number;
};

/** Contact form submission. Service-role read/write only — never client-read. */
export type ContactMessage = Timestamps & {
  id: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  /** Set when a signed-in visitor submitted; null for anonymous senders. */
  user_id: string | null;
  handled_at: string | null;
  handled_by: string | null;
};

/* ── Tutor agent ──────────────────────────────────────────────
 * Written by the FastAPI tutor service over a direct Postgres connection, not
 * by this app. All five are deny-all for anon/authenticated: reads go through
 * createAdminClient() in route handlers and server components, scoped to the
 * caller's own user_id. */

/** Google Drive sync ledger — one row per ingested file. */
export type SyncedFile = {
  id: string;
  name: string;
  mime_type: string;
  modified_time: string | null;
  md5_checksum: string | null;
  /** Drive URL. Never sent to the browser — students have no Drive access. */
  web_view_link: string | null;
  status: "synced" | "skipped" | "error";
  error: string | null;
  last_synced_at: string;
  created_at: string;
};

/** The retrieval index. `embedding` is pgvector and is deliberately omitted —
 * PostgREST would serialise 1536 floats into every row. */
export type Chunk = {
  id: string;
  file_id: string;
  file_name: string;
  page: number | null;
  section: string | null;
  content: string;
  asset_id: string | null;
  kind: "text" | "figure" | "table";
  created_at: string;
};

/** Append-only audit trail of every tutor exchange, and the cap counter.
 * Never deleted — "New conversation" moves tutor_threads instead. */
export type ChatMessage = {
  id: string;
  user_id: string | null;
  role: "user" | "assistant";
  content: string;
  /** Chunks retrieved for this answer; empty on a refusal. Null on user rows. */
  chunk_ids: string[] | null;
  /** "provider/model" that answered. Null on user rows. */
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
};

/** One stored image (figure crop or rendered page) from the materials. */
export type FileAsset = {
  id: string;
  file_id: string;
  content_hash: string;
  page: number | null;
  kind: "figure" | "page";
  storage_path: string;
  public_url: string;
  width: number | null;
  height: number | null;
  created_at: string;
};

/** Content-addressed vision-description cache. Never garbage-collected. */
export type AssetDescription = {
  content_hash: string;
  description: string;
  model: string | null;
  created_at: string;
};

/** Conversation boundary. History renders from conversation_started_at
 * forward; "New conversation" moves it and clears the checkpointer thread. */
export type TutorThread = {
  user_id: string;
  conversation_started_at: string;
  updated_at: string;
};

export type TutorRating = "up" | "down";

/** A rating on one tutor answer, with optional free-text detail. The quality
 * signal for a strict-RAG tutor: a thumbs-down usually means retrieval missed
 * or the corpus has a gap, a thumbs-up says the passages actually answered
 * the question. Also the liability paper trail. */
export type TutorAnswerFeedback = {
  id: string;
  user_id: string;
  message_id: string;
  rating: TutorRating;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
};

/** auth.users bridge (public.user_emails view) — service-role read only. */
export type UserEmail = {
  id: string;
  email: string | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      exams: Table<Exam>;
      exam_documents: Table<ExamDocument>;
      specialties: Table<Specialty>;
      subjects: Table<Subject>;
      questions: Table<Question>;
      question_options: Table<QuestionOption>;
      question_model_answers: Table<QuestionModelAnswer>;
      osce_grading_events: Table<OsceGradingEvent>;
      osce_grade_reports: Table<OsceGradeReport>;
      question_reports: Table<QuestionReport>;
      synced_files: Table<SyncedFile>;
      chunks: Table<Chunk>;
      chat_messages: Table<ChatMessage>;
      file_assets: Table<FileAsset>;
      asset_descriptions: Table<AssetDescription>;
      tutor_threads: Table<TutorThread>;
      tutor_answer_feedback: Table<TutorAnswerFeedback>;
      tests: Table<Test>;
      test_questions: Table<TestQuestion>;
      test_answers: Table<TestAnswer>;
      attempts: Table<Attempt>;
      bookmarks: Table<Bookmark>;
      notes: Table<Note>;
      audit_logs: Table<AuditLog>;
      subscriptions: Table<Subscription>;
      payment_events: Table<PaymentEvent>;
      payments: Table<Payment>;
      plans: Table<Plan>;
      contact_messages: Table<ContactMessage>;
      orgs: Table<Org>;
      org_departments: Table<OrgDepartment>;
      org_members: Table<OrgMember>;
      org_invites: Table<OrgInvite>;
      org_subscriptions: Table<OrgSubscription>;
      org_assignments: Table<OrgAssignment>;
      org_assignment_targets: Table<OrgAssignmentTarget>;
      org_exam_dates: Table<OrgExamDate>;
      study_plan_settings: Table<StudyPlanSettings>;
      study_plan_weeks: Table<StudyPlanWeek>;
      courses: Table<Course>;
      course_modules: Table<CourseModule>;
      course_lessons: Table<CourseLesson>;
      course_questions: Table<CourseQuestion>;
      course_question_options: Table<CourseQuestionOption>;
      course_lesson_progress: Table<CourseLessonProgress>;
      course_quiz_attempts: Table<CourseQuizAttempt>;
      course_certificates: Table<CourseCertificate>;
      analytics_daily_revenue: Table<AnalyticsDailyRevenue>;
      analytics_daily_refunds: Table<AnalyticsDailyRefund>;
      analytics_refund_marks: Table<AnalyticsRefundMark>;
      analytics_active_user_days: Table<AnalyticsActiveUserDay>;
      analytics_daily_engagement: Table<AnalyticsDailyEngagement>;
      analytics_daily_exam_activity: Table<AnalyticsDailyExamActivity>;
      analytics_question_stats: Table<AnalyticsQuestionStat>;
      reconcile_runs: Table<ReconcileRun>;
      analytics_state: Table<AnalyticsState>;
    };
    Views: {
      question_options_public: View<QuestionOptionPublic>;
      course_question_options_public: View<CourseQuestionOptionPublic>;
      user_stats: View<UserStats>;
      subject_accuracy: View<SubjectAccuracy>;
      user_daily_activity: View<UserDailyActivity>;
      user_mode_stats: View<UserModeStats>;
      user_exam_weekly_mode_accuracy: View<UserExamWeeklyModeAccuracy>;
      user_exam_weekly_activity: View<UserExamWeeklyActivity>;
      user_exam_stats: View<UserExamStats>;
      exam_subject_counts: View<ExamSubjectCounts>;
      user_exam_week_test_subject_attempts: View<UserExamWeekTestSubjectAttempts>;
      user_question_latest_outcome: View<UserQuestionLatestOutcome>;
      user_emails: View<UserEmail>;
      subject_question_counts: View<SubjectQuestionCount>;
      subject_osce_question_counts: View<SubjectOsceQuestionCount>;
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_org_member: { Args: { org: string }; Returns: boolean };
      is_org_admin: { Args: { org: string }; Returns: boolean };
      is_assignment_target: { Args: { assignment: string }; Returns: boolean };
      is_department_member: { Args: { dept: string }; Returns: boolean };
      assignment_org: { Args: { assignment: string }; Returns: string | null };
      exam_is_visible: { Args: { exam: string }; Returns: boolean };
      specialty_is_visible: { Args: { specialty: string }; Returns: boolean };
      subject_is_visible: { Args: { subject: string }; Returns: boolean };
      course_is_visible: { Args: { course: string }; Returns: boolean };
      course_lesson_visible: { Args: { lesson: string }; Returns: boolean };
      analytics_recompute_question_stats: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      analytics_book_refund: {
        Args: {
          p_payment_id: string;
          p_day: string;
          p_exam_key: string;
          p_plan_key: string;
          p_channel: AnalyticsRevenueChannel;
          p_source: string;
          p_currency: string;
          p_delta_cents: number;
          p_new_booked_cents: number;
        };
        Returns: undefined;
      };
      /** Moves the AI tutor's conversation boundary, stamped by the DATABASE
       * clock — it is compared against chat_messages.created_at. */
      tutor_reset_thread: {
        Args: { p_user: string };
        Returns: string;
      };
      /** Question-report evidence: live attempt counts per reported
       * question, split at questions.updated_at. Service-role only. */
      question_report_attempt_counts: {
        Args: { question_ids: string[] };
        Returns: {
          question_id: string;
          attempts: number;
          since_edit: number;
          before_edit: number;
        }[];
      };
      open_report_question_count: {
        Args: { p_org_id?: string | null };
        Returns: number;
      };
      question_report_pick_counts: {
        Args: { question_ids: string[] };
        Returns: {
          question_id: string;
          option_id: string;
          since_edit: boolean;
          picks: number;
        }[];
      };
      /** AI-tutor token usage per (Guyana day, model). The model-null row
       * carries the question count and refusals. Service-role only. */
      tutor_usage_by_day: {
        Args: { p_from?: string | null; p_to?: string | null };
        Returns: {
          day: string;
          model: string | null;
          questions: number;
          answers: number;
          measured: number;
          prompt_tokens: number;
          completion_tokens: number;
        }[];
      };
      /** Same buckets keyed by (user, model) for the top p_limit users by
       * total tokens. Service-role only. */
      tutor_usage_by_user: {
        Args: { p_from?: string | null; p_to?: string | null; p_limit?: number };
        Returns: {
          user_id: string;
          model: string | null;
          questions: number;
          answers: number;
          measured: number;
          prompt_tokens: number;
          completion_tokens: number;
          last_at: string;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      question_type: QuestionType;
      difficulty: Difficulty;
      test_status: TestStatus;
      sub_status: SubStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

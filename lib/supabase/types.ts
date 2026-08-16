/**
 * Database types for CME Prep.
 *
 * Hand-maintained to match supabase/migrations/*.sql. Once a Supabase project
 * is linked you can regenerate with:
 *   npx supabase gen types typescript --local > lib/supabase/types.ts
 */

export type UserRole = "trial" | "student" | "admin";
export type QuestionType = "mcq_single" | "mcq_multi" | "image_based";
export type Difficulty = "easy" | "medium" | "hard";
export type TestStatus = "in_progress" | "submitted" | "abandoned";
/** text + check constraint in Postgres, NOT a pg enum (payments precedent). */
export type TestMode = "exam" | "tutor";
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
   */
  mode?: TestMode;
};

type Timestamps = { created_at: string };

export type Profile = Timestamps & {
  id: string;
  full_name: string | null;
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
  flagged: boolean;
  time_spent_sec: number;
  /** Tutor only: set once by the reveal endpoint, never cleared. A revealed
   * answer is locked — the answers PATCH skips these rows. */
  revealed_at: string | null;
  updated_at: string;
};

export type Attempt = {
  id: string;
  test_id: string | null;
  user_id: string;
  question_id: string;
  selected_option_ids: string[];
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
  question_count: number;
};

/** Published, non-deleted questions per subject — the buyer-facing count. */
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
      specialties: Table<Specialty>;
      subjects: Table<Subject>;
      questions: Table<Question>;
      question_options: Table<QuestionOption>;
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
    };
    Views: {
      question_options_public: View<QuestionOptionPublic>;
      user_stats: View<UserStats>;
      subject_accuracy: View<SubjectAccuracy>;
      user_daily_activity: View<UserDailyActivity>;
      user_mode_stats: View<UserModeStats>;
      user_exam_weekly_mode_accuracy: View<UserExamWeeklyModeAccuracy>;
      user_exam_weekly_activity: View<UserExamWeeklyActivity>;
      user_exam_stats: View<UserExamStats>;
      exam_subject_counts: View<ExamSubjectCounts>;
      user_emails: View<UserEmail>;
      subject_question_counts: View<SubjectQuestionCount>;
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

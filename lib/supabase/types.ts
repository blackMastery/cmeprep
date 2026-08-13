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
export type SubStatus = "active" | "expired" | "cancelled";

export type TestConfig = {
  subject_ids: string[];
  difficulty: Difficulty | "mixed";
  num_questions: number;
  duration_sec: number;
  /** Absent on tests created before the exam level existed. */
  exam_id?: string;
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
  config: TestConfig;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  score: number | null;
  total_questions: number;
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

export type OrgMember = {
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  joined_at: string;
};

export type OrgInvite = {
  id: string;
  org_id: string;
  /** citext in Postgres — comparisons are case-insensitive. */
  email: string;
  role: OrgMemberRole;
  invited_by: string | null;
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
  status: SubStatus;
  current_period_end: string;
  updated_at: string | null;
};

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
      org_members: Table<OrgMember>;
      org_invites: Table<OrgInvite>;
      org_subscriptions: Table<OrgSubscription>;
    };
    Views: {
      question_options_public: View<QuestionOptionPublic>;
      user_stats: View<UserStats>;
      subject_accuracy: View<SubjectAccuracy>;
      user_daily_activity: View<UserDailyActivity>;
      user_emails: View<UserEmail>;
      subject_question_counts: View<SubjectQuestionCount>;
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_org_member: { Args: { org: string }; Returns: boolean };
      is_org_admin: { Args: { org: string }; Returns: boolean };
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

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
  topic_ids: string[];
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

export type Topic = Timestamps & {
  id: string;
  subject_id: string;
  name: string;
  position: number;
};

export type Question = Timestamps & {
  id: string;
  topic_id: string;
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
  created_at: string;
};

export type UserStats = {
  user_id: string;
  attempted: number;
  correct: number;
  accuracy_pct: number;
};

export type TopicAccuracy = {
  user_id: string;
  topic_id: string;
  topic_name: string;
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

export type Subscription = Timestamps & {
  id: string;
  user_id: string;
  paypal_subscription_id: string | null;
  /** Free text snapshot; presets come from the plans table. */
  plan: string;
  status: SubStatus;
  current_period_end: string;
};

/** PayPal webhook deliveries — unique event id is the idempotency key. */
export type PaymentEvent = {
  id: string;
  paypal_event_id: string;
  type: string;
  payload: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
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
      topics: Table<Topic>;
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
      plans: Table<Plan>;
    };
    Views: {
      question_options_public: View<QuestionOptionPublic>;
      user_stats: View<UserStats>;
      topic_accuracy: View<TopicAccuracy>;
      user_daily_activity: View<UserDailyActivity>;
      user_emails: View<UserEmail>;
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
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

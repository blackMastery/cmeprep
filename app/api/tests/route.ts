import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { createTestSchema } from "@/lib/validation";
import { shuffle } from "@/lib/scoring";
import type { TestConfig } from "@/lib/supabase/types";

/**
 * POST /api/tests — create a timed test.
 *
 * Server-authoritative: picks the questions, freezes the option order, sets
 * expires_at, and consumes a trial credit atomically. The response contains
 * no correctness data.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createTestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { subjectIds, topicIds, difficulty, numQuestions, durationMin } =
    parsed.data;
  const admin = createAdminClient();

  // ── Trial quota: one atomic statement, so two concurrent requests can
  // never both consume the final credit.
  if (user.profile.role === "trial") {
    const { data: claimed, error: claimError } = await admin
      .from("profiles")
      .update({ trials_used: user.profile.trials_used + 1 })
      .eq("id", user.id)
      .lt("trials_used", user.profile.trials_limit)
      .eq("trials_used", user.profile.trials_used)
      .select("trials_used")
      .maybeSingle();

    if (claimError) {
      return NextResponse.json(
        { error: "Could not start test" },
        { status: 500 }
      );
    }
    if (!claimed) {
      return NextResponse.json(
        {
          error: "trial_limit_reached",
          message:
            "You've used all your free practice tests. Upgrade to keep going.",
        },
        { status: 403 }
      );
    }
  }

  // ── Select candidate questions
  let query = admin
    .from("questions")
    .select("id, topic_id, topics!inner(subject_id)")
    .eq("is_published", true)
    .is("deleted_at", null);

  if (topicIds.length > 0) {
    query = query.in("topic_id", topicIds);
  } else {
    query = query.in("topics.subject_id", subjectIds);
  }

  if (difficulty !== "mixed") {
    query = query.eq("difficulty", difficulty);
  }

  const { data: candidates, error: qError } = await query.limit(500);

  if (qError) {
    await refundTrial(user.id, user.profile.role, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not load questions" },
      { status: 500 }
    );
  }

  if (!candidates || candidates.length === 0) {
    await refundTrial(user.id, user.profile.role, user.profile.trials_used);
    return NextResponse.json(
      {
        error: "no_questions",
        message:
          "No published questions match those filters yet. Try widening your selection.",
      },
      { status: 422 }
    );
  }

  const picked = shuffle(candidates).slice(
    0,
    Math.min(numQuestions, candidates.length)
  );

  // ── Freeze option order per question
  const { data: options, error: optError } = await admin
    .from("question_options")
    .select("id, question_id")
    .is("deleted_at", null) // retired options never enter a new paper
    .in(
      "question_id",
      picked.map((q) => q.id)
    );

  if (optError || !options) {
    await refundTrial(user.id, user.profile.role, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not load options" },
      { status: 500 }
    );
  }

  const optionsByQuestion = new Map<string, string[]>();
  for (const opt of options) {
    const list = optionsByQuestion.get(opt.question_id) ?? [];
    list.push(opt.id);
    optionsByQuestion.set(opt.question_id, list);
  }

  const config: TestConfig = {
    subject_ids: subjectIds,
    topic_ids: topicIds,
    difficulty,
    num_questions: picked.length,
    duration_sec: durationMin * 60,
  };

  const expiresAt = new Date(Date.now() + durationMin * 60_000).toISOString();

  const { data: test, error: testError } = await admin
    .from("tests")
    .insert({
      user_id: user.id,
      status: "in_progress",
      config,
      expires_at: expiresAt,
      total_questions: picked.length,
    })
    .select("id")
    .single();

  if (testError || !test) {
    await refundTrial(user.id, user.profile.role, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not create test" },
      { status: 500 }
    );
  }

  const rows = picked.map((q, index) => ({
    test_id: test.id,
    question_id: q.id,
    position: index,
    option_order: shuffle(optionsByQuestion.get(q.id) ?? []),
  }));

  const { error: linkError } = await admin.from("test_questions").insert(rows);

  if (linkError) {
    await admin.from("tests").delete().eq("id", test.id);
    await refundTrial(user.id, user.profile.role, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not create test" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: test.id }, { status: 201 });
}

/** Give a trial credit back when test creation fails after consuming it. */
async function refundTrial(
  userId: string,
  role: string,
  previousUsed: number
): Promise<void> {
  if (role !== "trial") return;
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ trials_used: previousUsed })
    .eq("id", userId);
}

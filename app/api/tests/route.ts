import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { createTestSchema, testModeSchema, uuid } from "@/lib/validation";
import { examAccessFrom } from "@/lib/entitlements";
import { canAccessExam, consumesTrialCredit } from "@/lib/entitlements-core";
import { countsTowardDeptAssignment } from "@/lib/orgs-core";
import { shuffle } from "@/lib/scoring";
import type { OrgAssignment, TestConfig } from "@/lib/supabase/types";

/**
 * POST /api/tests — create a test: a timed exam or an untimed tutor session.
 *
 * Server-authoritative: picks the questions, freezes the option order, sets
 * expires_at (exam mode only — tutor sessions never expire), and consumes a
 * trial credit atomically. The response contains no correctness data.
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
  const admin = createAdminClient();

  // ── Assignment launch: the SERVER supplies the config, verbatim from the
  // prescription — the client sends only the assignment id (SPEC §7).
  let assignment: OrgAssignment | null = null;
  const rawAssignmentId =
    typeof body === "object" && body !== null && "assignmentId" in body
      ? String((body as Record<string, unknown>).assignmentId)
      : null;
  if (rawAssignmentId !== null) {
    const assignmentId = uuid().safeParse(rawAssignmentId);
    if (!assignmentId.success) {
      return NextResponse.json({ error: "Unknown assignment" }, { status: 404 });
    }
    const { data } = await admin
      .from("org_assignments")
      .select("*")
      .eq("id", assignmentId.data)
      .is("deleted_at", null)
      .maybeSingle();
    assignment = (data as OrgAssignment | null) ?? null;
    if (!assignment) {
      return NextResponse.json({ error: "Unknown assignment" }, { status: 404 });
    }

    // Addressed to this member? Membership + (all | targeted | department
    // cohort). Late starts are allowed — a late completion beats none, and
    // it is flagged.
    const [{ data: membership }, { data: target }] = await Promise.all([
      admin
        .from("org_members")
        .select("org_id, department_id, department_changed_at")
        .eq("user_id", user.id)
        .eq("org_id", assignment.org_id)
        .maybeSingle(),
      admin
        .from("org_assignment_targets")
        .select("user_id")
        .eq("assignment_id", assignment.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const addressed =
      membership !== null &&
      (assignment.audience === "all" ||
        (assignment.audience === "selected" && target !== null) ||
        (assignment.audience === "department" &&
          countsTowardDeptAssignment(membership, assignment)));
    if (!addressed) {
      return NextResponse.json({ error: "Unknown assignment" }, { status: 404 });
    }
  }

  // The member may launch an assignment in the other mode ("do this mock as
  // practice") — completions still count, labeled with the mode actually used.
  let modeOverride: "exam" | "tutor" | null = null;
  if (
    assignment &&
    typeof body === "object" &&
    body !== null &&
    "mode" in body
  ) {
    const override = testModeSchema.safeParse(
      (body as Record<string, unknown>).mode
    );
    if (!override.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    modeOverride = override.data;
  }

  const parsed = assignment ? null : createTestSchema.safeParse(body);
  if (parsed && !parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { examId, subjectIds, difficulty, numQuestions, durationMin, mode } =
    assignment
      ? {
          examId: assignment.config.exam_id ?? "",
          subjectIds: assignment.config.subject_ids,
          difficulty: assignment.config.difficulty,
          numQuestions: assignment.config.num_questions,
          // Tutor prescriptions carry no duration; if the member overrides
          // one INTO exam mode, default to a minute per question so the
          // override never dies for lack of a timer setting.
          durationMin: Math.round(
            (assignment.config.duration_sec ??
              assignment.config.num_questions * 60) / 60
          ),
          mode: modeOverride ?? assignment.config.mode ?? ("exam" as const),
        }
      : parsed!.data;
  if (!examId) {
    return NextResponse.json({ error: "Unknown assignment" }, { status: 404 });
  }
  // createTestSchema guarantees this pair for wizard requests; assignments
  // get the fallback above. Belt-and-braces so exam inserts can never trip
  // the tests_expires_at_by_mode CHECK with a null deadline.
  if (mode === "exam" && durationMin === undefined) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // ── Entitlement: a paid plan buys ONE exam. This is the hard block — the
  // wizard only renders locks. Trial users pass (they may practise any exam);
  // the quota below is their limiter. Checked BEFORE the trial claim, so a
  // blocked request never burns a credit. The exam row is fetched for its
  // org_id: private banks are members-only and the admin client bypasses the
  // RLS that would otherwise enforce that wall.
  const [access, { data: exam }] = await Promise.all([
    examAccessFrom(admin, user.id, user.profile.role),
    admin.from("exams").select("id, org_id").eq("id", examId).maybeSingle(),
  ]);
  if (!exam || !canAccessExam(access, { id: exam.id, orgId: exam.org_id })) {
    return NextResponse.json(
      {
        error: "exam_locked",
        message: "Your subscription doesn't include that examination.",
      },
      { status: 403 }
    );
  }

  // ── Integrity: every chosen subject must belong to the chosen exam.
  // Checked BEFORE the trial claim so no refund path is needed.
  const { data: examSubjects, error: examCheckError } = await admin
    .from("subjects")
    .select("id, specialties!inner(exam_id)")
    .in("id", subjectIds)
    .eq("specialties.exam_id", examId);

  if (examCheckError) {
    return NextResponse.json({ error: "Could not start test" }, { status: 500 });
  }
  if ((examSubjects?.length ?? 0) !== subjectIds.length) {
    return NextResponse.json(
      {
        error: "exam_mismatch",
        message: "Those subjects don't belong to the chosen exam.",
      },
      { status: 400 }
    );
  }

  // ── Trial quota: one atomic statement, so two concurrent requests can
  // never both consume the final credit. Org-COVERED exams are unmetered —
  // the org bought this exam (or comps everything, or owns the bank), so a
  // trial-ROLE member neither burns a credit nor gets blocked at zero on it;
  // anything outside the org's coverage rides the quota as usual (SPEC §3).
  const consumesTrial = consumesTrialCredit(user.profile.role, access, {
    id: exam.id,
    orgId: exam.org_id,
  });
  if (consumesTrial) {
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
    .select("id, subject_id")
    .eq("is_published", true)
    .is("deleted_at", null)
    .in("subject_id", subjectIds);

  if (difficulty !== "mixed") {
    query = query.eq("difficulty", difficulty);
  }

  const { data: candidates, error: qError } = await query.limit(500);

  if (qError) {
    await refundTrial(consumesTrial, user.id, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not load questions" },
      { status: 500 }
    );
  }

  if (!candidates || candidates.length === 0) {
    await refundTrial(consumesTrial, user.id, user.profile.trials_used);
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
    await refundTrial(consumesTrial, user.id, user.profile.trials_used);
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

  // config.mode is deliberately NOT set here — tests.mode (the column) is
  // the single source of truth on test rows; config.mode exists only as an
  // assignment prescription input.
  const config: TestConfig = {
    subject_ids: subjectIds,
    difficulty,
    num_questions: picked.length,
    ...(mode === "exam" ? { duration_sec: durationMin! * 60 } : {}),
    exam_id: examId,
  };

  // Tutor sessions are untimed and resumable indefinitely (CHECK-constrained
  // to a null deadline).
  const expiresAt =
    mode === "exam"
      ? new Date(Date.now() + durationMin! * 60_000).toISOString()
      : null;

  const { data: test, error: testError } = await admin
    .from("tests")
    .insert({
      user_id: user.id,
      status: "in_progress",
      mode,
      config,
      expires_at: expiresAt,
      total_questions: picked.length,
      assignment_id: assignment?.id ?? null,
    })
    .select("id")
    .single();

  if (testError || !test) {
    await refundTrial(consumesTrial, user.id, user.profile.trials_used);
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
    await refundTrial(consumesTrial, user.id, user.profile.trials_used);
    return NextResponse.json(
      { error: "Could not create test" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: test.id }, { status: 201 });
}

/** Give a trial credit back when test creation fails after consuming it. */
async function refundTrial(
  consumed: boolean,
  userId: string,
  previousUsed: number
): Promise<void> {
  if (!consumed) return;
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ trials_used: previousUsed })
    .eq("id", userId);
}

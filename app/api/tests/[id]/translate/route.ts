import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { translateQuestionSchema } from "@/lib/validation";
import { getTestForUser, isQuestionRevealed } from "@/lib/tests";
import { withheldQuestionIds } from "@/lib/results";
import {
  resolveTranslationLanguage,
  revealFieldsAllowed,
  TRANSLATION_USER_DAILY_CAP,
} from "@/lib/translation-core";
import {
  invokeTranslateFunction,
  listEnabledLanguageCodes,
  loadTranslationsFor,
  translationCapHit,
  type CachedTranslation,
} from "@/lib/translations";

// A fresh translation is one Edge Function call of up to ~50s; Vercel
// Hobby's ceiling is 60s and the function budget sits under it on purpose.
export const maxDuration = 60;

export type TranslatePayload = {
  questionId: string;
  language: string;
  stem: string;
  /** option id → translated label. */
  options: Record<string, string>;
  /** Only when the English explanation would be served right now. */
  explanation?: string;
  modelAnswer?: string;
  source: "cache" | "fresh";
};

/**
 * POST /api/tests/[id]/translate — the student's Translate button.
 *
 * One question, in the paper's language: served from question_translations
 * when a current row exists (free, no cap), otherwise translated now through
 * the Edge Function and cached for everyone after. This route owns every
 * check the function trusts: identity, that the question is on THIS
 * student's paper and still readable by them (the org wall review applies),
 * that the language is enabled, the daily caps — and the mid-test
 * withholding rule, applied to the translated explanation and model answer
 * exactly as the English ones (revealFieldsAllowed + isQuestionRevealed).
 *
 * Language: resolveTranslationLanguage — the paper's frozen language wins;
 * otherwise the request's (the first-click picker), otherwise a still-enabled
 * profile default. Whatever resolves is frozen onto the test (and onto an
 * empty profile default) so review shows the language the paper was taken
 * in; if a concurrent first click froze it first, this call follows that.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/tests/[id]/translate">
) {
  const { id } = await ctx.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Every fresh call spends real money — mirror the grade route's ban gate.
  if (user.profile.banned_at) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = translateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { questionId } = parsed.data;

  const test = await getTestForUser(id, user.id);
  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  // Independent reads in parallel — the exam clock runs while this waits.
  const [{ data: link }, withheld, enabled, revealed] = await Promise.all([
    admin
      .from("test_questions")
      .select("question_id")
      .eq("test_id", id)
      .eq("question_id", questionId)
      .maybeSingle(),
    // Private-bank content the student can no longer read (they left the
    // org) is withheld here as in review — a translation is the org's
    // content too, and this is the one channel that can serve it.
    withheldQuestionIds(admin, [questionId], user.id),
    listEnabledLanguageCodes(),
    isQuestionRevealed(admin, test, questionId),
  ]);
  if (!link || withheld.has(questionId)) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // ── Which language ───────────────────────────────────────
  const resolution = resolveTranslationLanguage({
    testLanguage: test.language,
    requested: parsed.data.language,
    profileDefault: user.profile.preferred_language,
    enabled,
  });
  if (resolution.refused) {
    return NextResponse.json(
      {
        error: "language_not_enabled",
        message: "That translation language isn't available.",
      },
      { status: 400 }
    );
  }
  let language = resolution.language;
  if (!language) {
    return NextResponse.json({ error: "language_required" }, { status: 409 });
  }
  if (test.language === null) {
    // Guarded on null so a concurrent first click can't flip the paper to a
    // second language. The two freezes are independent, so they run
    // together; only the paper's outcome matters below.
    const [{ data: frozen }] = await Promise.all([
      admin
        .from("tests")
        .update({ language })
        .eq("id", test.id)
        .is("language", null)
        .select("language")
        .maybeSingle(),
      user.profile.preferred_language === null
        ? admin
            .from("profiles")
            .update({ preferred_language: language })
            .eq("id", user.id)
            .is("preferred_language", null)
        : Promise.resolve(null),
    ]);
    if (!frozen) {
      // Lost the race: the paper is now frozen to the winner's language.
      // Translate into THAT one, so the paper never mixes languages and the
      // client's "follow the server" correction sees the real value.
      const { data: current } = await admin
        .from("tests")
        .select("language")
        .eq("id", test.id)
        .maybeSingle();
      if (current?.language) language = current.language;
    }
  }
  const chosen = language;

  // The explanation is answer-key material: same rule as the reveal data.
  const allowed = revealFieldsAllowed(test, revealed);
  const respond = (t: CachedTranslation, source: "cache" | "fresh") =>
    NextResponse.json({
      questionId,
      language: chosen,
      stem: t.stem,
      options: t.options,
      ...(allowed.explanation ? { explanation: t.explanation } : {}),
      ...(allowed.modelAnswer && t.modelAnswer !== null
        ? { modelAnswer: t.modelAnswer }
        : {}),
      source,
    } satisfies TranslatePayload);

  // ── Cache hit: free, uncounted ───────────────────────────
  const cached = (await loadTranslationsFor(admin, [questionId], chosen)).get(
    questionId
  );
  if (cached) return respond(cached, "cache");

  // ── Caps, checked only for a call that would cost money ──
  const cap = await translationCapHit(admin, user.id, new Date());
  if (cap) {
    return NextResponse.json(
      {
        error: "capped",
        reason: cap,
        message:
          cap === "user_cap"
            ? `You've reached today's limit of ${TRANSLATION_USER_DAILY_CAP} translations. It resets at midnight.`
            : "Translation is very busy today — please try again tomorrow.",
      },
      { status: 429 }
    );
  }

  // ── The call ─────────────────────────────────────────────
  const result = await invokeTranslateFunction({
    questionId,
    language: chosen,
    userId: user.id,
    testId: test.id,
    trigger: "student",
  });
  if (!result.ok) {
    if (result.error === "question_not_found") {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    // The events table has the OpenAI error; this line is what the Next log
    // shows, so a bad model id or a rejected key is diagnosable from here.
    console.error("translate function failed", {
      questionId,
      language: chosen,
      error: result.error,
      detail: result.detail ?? null,
    });
    return NextResponse.json(
      {
        error: "translation_unavailable",
        message: "Translation is unavailable right now — showing English.",
      },
      { status: result.error === "not_configured" ? 503 : 502 }
    );
  }
  const t = result.translation;
  return respond(
    {
      language: chosen,
      stem: t.stem,
      options: t.options,
      explanation: t.explanation,
      modelAnswer: t.modelAnswer,
    },
    result.fresh ? "fresh" : "cache"
  );
}

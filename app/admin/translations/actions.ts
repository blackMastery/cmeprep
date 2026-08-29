"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/admin/audit";
import {
  deleteTranslation,
  regenerateTranslation,
  setLanguageEnabled,
} from "@/lib/admin/translations";
import { languageByCode } from "@/lib/translation-core";
import { languageCodeSchema, uuid } from "@/lib/validation";

export type TranslationState = { error?: string; success?: string } | null;

/**
 * requireAdmin() is the FIRST statement of every action, outside any
 * try/catch: layouts do not gate Server Actions, and the guard signals by
 * throwing NEXT_REDIRECT, which a catch block would swallow.
 */

function parseTarget(formData: FormData) {
  const questionId = uuid().safeParse(formData.get("questionId"));
  const language = languageCodeSchema.safeParse(formData.get("language"));
  if (!questionId.success || !language.success) return null;
  return { questionId: questionId.data, language: language.data };
}

/** Translate this row again, replacing the cached text. One OpenAI call. */
export async function regenerateTranslationAction(
  _prev: TranslationState,
  formData: FormData
): Promise<TranslationState> {
  const user = await requireAdmin();

  const target = parseTarget(formData);
  if (!target) return { error: "Invalid request" };

  const result = await regenerateTranslation(
    target.questionId,
    target.language,
    user.id
  );
  await audit(user.id, "translation.regenerate", target.questionId, {
    language: target.language,
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error }),
  });
  if (!result.ok) {
    return {
      error:
        result.error === "not_configured"
          ? "Translation isn't configured (OPENAI_API_KEY on the function)."
          : result.error === "question_not_found"
            ? "That question no longer exists."
            : "Could not regenerate — the translation service failed. Try again.",
    };
  }

  revalidatePath("/admin/translations");
  const name = languageByCode(target.language)?.name ?? target.language;
  return { success: `Regenerated the ${name} translation.` };
}

/** Drop the cached row; the next student click re-translates. */
export async function deleteTranslationAction(
  _prev: TranslationState,
  formData: FormData
): Promise<TranslationState> {
  const user = await requireAdmin();

  const target = parseTarget(formData);
  if (!target) return { error: "Invalid request" };

  if (!(await deleteTranslation(target.questionId, target.language))) {
    return { error: "Could not delete the translation. Try again." };
  }
  await audit(user.id, "translation.delete", target.questionId, {
    language: target.language,
  });

  revalidatePath("/admin/translations");
  return { success: "Translation deleted." };
}

/** Switch a registry language on or off for students. Plain-arg action for
 * the optimistic toggle (bookmark-toggle precedent). */
export async function setLanguageEnabledAction(
  code: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAdmin();

  const parsed = languageCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: "Unknown language" };

  if (!(await setLanguageEnabled(parsed.data, enabled, user.id))) {
    return { ok: false, error: "Could not update the language." };
  }
  await audit(
    user.id,
    enabled ? "translation.language_enable" : "translation.language_disable",
    null,
    { language: parsed.data }
  );

  revalidatePath("/admin/translations");
  return { ok: true };
}

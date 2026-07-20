"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/**
 * Bookmark + note mutations. All writes go through the RLS'd client on
 * purpose: both tables grant INSERT/UPDATE/DELETE to `authenticated` with
 * own-row policies, so the database enforces ownership even if this code
 * regressed. requireUser() is the first statement of every action — layouts
 * do not gate Server Actions.
 */

export type NoteState = { error?: string; success?: string } | null;
export type BookmarkFormState = { error?: string } | null;

const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something first")
  .max(2000, "Notes are capped at 2000 characters");

/** Plain-argument action for the optimistic toggle on review cards. */
export async function toggleBookmark(
  questionId: string,
  next: boolean
): Promise<{ ok: boolean }> {
  const user = await requireUser();

  const parsed = uuid().safeParse(questionId);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = next
    ? await supabase.from("bookmarks").upsert(
        { user_id: user.id, question_id: parsed.data },
        // Idempotent under double-clicks: the second insert is a no-op.
        { onConflict: "user_id,question_id", ignoreDuplicates: true }
      )
    : await supabase
        .from("bookmarks")
        .delete()
        .match({ user_id: user.id, question_id: parsed.data });

  if (error) return { ok: false };

  revalidatePath("/bookmarks");
  return { ok: true };
}

/** FormData twin of the delete branch, for ConfirmSubmit forms on /bookmarks. */
export async function removeBookmark(
  _prev: BookmarkFormState,
  formData: FormData
): Promise<BookmarkFormState> {
  const user = await requireUser();

  const parsed = uuid().safeParse(formData.get("questionId"));
  if (!parsed.success) return { error: "Invalid question." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .match({ user_id: user.id, question_id: parsed.data });

  if (error) return { error: "Could not remove the bookmark." };

  revalidatePath("/bookmarks");
  return null;
}

export async function saveNote(
  _prev: NoteState,
  formData: FormData
): Promise<NoteState> {
  const user = await requireUser();

  const id = uuid().safeParse(formData.get("questionId"));
  if (!id.success) return { error: "Invalid question." };

  const body = noteBodySchema.safeParse(formData.get("body"));
  if (!body.success) return { error: body.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("notes").upsert(
    {
      user_id: user.id,
      question_id: id.data,
      body: body.data,
      // No on-update trigger exists; the full-column grant allows this.
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,question_id" }
  );

  if (error) return { error: "Could not save your note." };

  revalidatePath("/bookmarks");
  return { success: "Note saved." };
}

export async function deleteNote(
  _prev: NoteState,
  formData: FormData
): Promise<NoteState> {
  const user = await requireUser();

  const id = uuid().safeParse(formData.get("questionId"));
  if (!id.success) return { error: "Invalid question." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notes")
    .delete()
    .match({ user_id: user.id, question_id: id.data });

  if (error) return { error: "Could not delete the note." };

  revalidatePath("/bookmarks");
  return { success: "Note deleted." };
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  assembleCatalog,
  toExamSummary,
  type CatalogExam,
  type CatalogExamDetail,
} from "@/lib/catalog-core";

/**
 * The taxonomy as a student or a buyer sees it.
 *
 * Reads through the RLS client on purpose — lib/admin/taxonomy.ts is
 * server-only + service-role and would hand a student the unpublished
 * catalogue. Question counts come from subject_question_counts, which pins
 * `is_published and deleted_at is null` for every reader.
 */
export async function listExamCatalogTree(): Promise<CatalogExamDetail[]> {
  const supabase = await createClient();

  const [
    { data: exams },
    { data: specialties },
    { data: subjects },
    { data: counts },
  ] = await Promise.all([
    supabase
      .from("exams")
      .select("id, name, code, is_active, org_id")
      .order("position")
      .order("name"),
    supabase
      .from("specialties")
      .select("id, name, exam_id")
      .order("position")
      .order("name"),
    supabase
      .from("subjects")
      .select("id, name, specialty_id")
      .order("position")
      .order("name"),
    supabase.from("subject_question_counts").select("subject_id, question_count"),
  ]);

  return assembleCatalog({
    exams: exams ?? [],
    specialties: specialties ?? [],
    subjects: subjects ?? [],
    counts: counts ?? [],
  });
}

/** Every exam with its counts, without the tree — for pickers and cards. */
export async function listExamCatalog(): Promise<CatalogExam[]> {
  const tree = await listExamCatalogTree();
  return tree.map(toExamSummary);
}

/** One exam with its full specialty → subject tree. */
export async function getExamCatalog(
  id: string
): Promise<CatalogExamDetail | null> {
  const tree = await listExamCatalogTree();
  return tree.find((exam) => exam.id === id) ?? null;
}

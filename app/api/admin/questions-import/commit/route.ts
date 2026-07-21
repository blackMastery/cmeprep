import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminJson } from "@/lib/admin/api-auth";
import { audit } from "@/lib/admin/audit";
import { analyzeUpload } from "@/lib/admin/import";
import type { ImportCommitResponse, ImportReport } from "@/lib/admin/import-api";
import {
  PLACEHOLDER_TOPIC_ID,
  normalizeKey,
  type ImportAnalysis,
} from "@/lib/admin/import-core";
import { diffOptions } from "@/lib/admin/option-diff";
import { listHierarchy, nextPosition } from "@/lib/admin/taxonomy";
import { createAdminClient } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";
const CHUNK_SIZE = 100;

function reportOf(analysis: ImportAnalysis): ImportReport {
  return {
    fileErrors: analysis.fileErrors,
    lines: analysis.lines,
    counts: analysis.counts,
    creationPlan: analysis.creationPlan,
  };
}

function fail(
  status: number,
  error: string,
  report?: ImportReport
): NextResponse {
  return NextResponse.json<ImportCommitResponse>(
    { ok: false, error, report },
    { status }
  );
}

/**
 * POST /api/admin/questions-import/commit
 * FormData: file (.xlsx), autoCreate ("true"|"false"), fileSha256 (from preview)
 *
 * Re-parses and re-validates the file from scratch (same code path as
 * preview), creates any planned taxonomy, then inserts every valid row as a
 * DRAFT question. All-or-nothing: any insert failure deletes everything this
 * request inserted.
 */
export async function POST(request: Request) {
  const gate = await requireAdminJson();
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Invalid upload.");

  const expectedSha = String(form.get("fileSha256") ?? "");
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    return fail(400, "Run preview first — the commit is missing its file fingerprint.");
  }

  const autoCreate = form.get("autoCreate") === "true";
  const result = await analyzeUpload(form.get("file"), autoCreate);
  if (!result.ok) return fail(400, result.error);

  // The file must be byte-identical to the one previewed; otherwise the admin
  // approved a report for a different sheet.
  if (result.fileSha256 !== expectedSha) {
    return fail(
      409,
      "This file changed since the preview — run preview again and re-check the report."
    );
  }

  const { analysis } = result;
  if (analysis.fileErrors.length > 0) {
    return fail(422, analysis.fileErrors[0], reportOf(analysis));
  }
  if (analysis.validRows.length === 0) {
    return fail(422, "No valid rows to import.", reportOf(analysis));
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // ── Execute the taxonomy creation plan ──────────────────────
  // Fully-qualified case-insensitive keys mirror the core; 23505 means an
  // exact-name race with another admin — refetch SCOPED BY PARENT (subject
  // names are only unique per specialty now, so a bare name lookup would be
  // ambiguous) and continue.
  const hierarchy = await listHierarchy();

  const examIdByNorm = new Map<string, string>();
  const specialtyIdByKey = new Map<string, string>();
  const subjectIdByKey = new Map<string, string>();
  const topicIdByKey = new Map<string, string>();
  const examPositions: { position: number }[] = [];
  const specialtyPositions = new Map<string, { position: number }[]>();
  const subjectPositions = new Map<string, { position: number }[]>();
  const topicPositions = new Map<string, { position: number }[]>();

  for (const exam of hierarchy) {
    const examNorm = normalizeKey(exam.name);
    examIdByNorm.set(examNorm, exam.id);
    examPositions.push({ position: exam.position });
    for (const sp of exam.specialties) {
      const specKey = `${examNorm}::${normalizeKey(sp.name)}`;
      specialtyIdByKey.set(specKey, sp.id);
      specialtyPositions.set(
        exam.id,
        [...(specialtyPositions.get(exam.id) ?? []), { position: sp.position }]
      );
      for (const subject of sp.subjects) {
        const subjKey = `${specKey}::${normalizeKey(subject.name)}`;
        subjectIdByKey.set(subjKey, subject.id);
        subjectPositions.set(
          sp.id,
          [
            ...(subjectPositions.get(sp.id) ?? []),
            { position: subject.position },
          ]
        );
        for (const topic of subject.topics) {
          topicIdByKey.set(
            `${subjKey}::${normalizeKey(topic.name)}`,
            topic.id
          );
          topicPositions.set(
            subject.id,
            [
              ...(topicPositions.get(subject.id) ?? []),
              { position: topic.position },
            ]
          );
        }
      }
    }
  }

  const createdExams: string[] = [];
  const createdSpecialties: string[] = [];
  const createdSubjects: string[] = [];
  const createdTopics: string[] = [];

  for (const planned of analysis.creationPlan.exams) {
    const norm = normalizeKey(planned.name);
    if (examIdByNorm.has(norm)) continue;

    const { data, error } = await admin
      .from("exams")
      .insert({ name: planned.name, position: nextPosition(examPositions) })
      .select("id")
      .single();

    if (error?.code === UNIQUE_VIOLATION) {
      // exams.name is globally unique, so a bare-name refetch is safe here.
      const { data: existing } = await admin
        .from("exams")
        .select("id")
        .eq("name", planned.name)
        .maybeSingle();
      if (!existing) return fail(500, `Could not create exam "${planned.name}".`);
      examIdByNorm.set(norm, existing.id);
      continue;
    }
    if (error || !data) {
      return fail(500, `Could not create exam "${planned.name}".`);
    }

    examIdByNorm.set(norm, data.id);
    examPositions.push({ position: examPositions.length });
    createdExams.push(planned.name);
    await audit(user.id, "exam.create", data.id, {
      name: planned.name,
      via: "bulk_import",
    });
  }

  for (const planned of analysis.creationPlan.specialties) {
    const examNorm = normalizeKey(planned.examName);
    const key = `${examNorm}::${normalizeKey(planned.name)}`;
    if (specialtyIdByKey.has(key)) continue;

    const examId = examIdByNorm.get(examNorm);
    if (!examId) {
      return fail(500, `Missing exam for specialty "${planned.name}".`);
    }

    const siblings = specialtyPositions.get(examId) ?? [];
    const { data, error } = await admin
      .from("specialties")
      .insert({
        exam_id: examId,
        name: planned.name,
        position: nextPosition(siblings),
      })
      .select("id")
      .single();

    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from("specialties")
        .select("id")
        .eq("exam_id", examId)
        .eq("name", planned.name)
        .maybeSingle();
      if (!existing)
        return fail(500, `Could not create specialty "${planned.name}".`);
      specialtyIdByKey.set(key, existing.id);
      continue;
    }
    if (error || !data) {
      return fail(500, `Could not create specialty "${planned.name}".`);
    }

    specialtyIdByKey.set(key, data.id);
    specialtyPositions.set(examId, [...siblings, { position: siblings.length }]);
    createdSpecialties.push(`${planned.examName} › ${planned.name}`);
    await audit(user.id, "specialty.create", data.id, {
      name: planned.name,
      examId,
      via: "bulk_import",
    });
  }

  for (const planned of analysis.creationPlan.subjects) {
    const specKey = `${normalizeKey(planned.examName)}::${normalizeKey(planned.specialtyName)}`;
    const key = `${specKey}::${normalizeKey(planned.name)}`;
    if (subjectIdByKey.has(key)) continue;

    const specialtyId = specialtyIdByKey.get(specKey);
    if (!specialtyId) {
      return fail(500, `Missing specialty for subject "${planned.name}".`);
    }

    const siblings = subjectPositions.get(specialtyId) ?? [];
    const { data, error } = await admin
      .from("subjects")
      .insert({
        specialty_id: specialtyId,
        name: planned.name,
        position: nextPosition(siblings),
      })
      .select("id")
      .single();

    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from("subjects")
        .select("id")
        .eq("specialty_id", specialtyId)
        .eq("name", planned.name)
        .maybeSingle();
      if (!existing)
        return fail(500, `Could not create subject "${planned.name}".`);
      subjectIdByKey.set(key, existing.id);
      continue;
    }
    if (error || !data) {
      return fail(500, `Could not create subject "${planned.name}".`);
    }

    subjectIdByKey.set(key, data.id);
    subjectPositions.set(specialtyId, [
      ...siblings,
      { position: siblings.length },
    ]);
    createdSubjects.push(`${planned.specialtyName} › ${planned.name}`);
    await audit(user.id, "subject.create", data.id, {
      name: planned.name,
      specialtyId,
      via: "bulk_import",
    });
  }

  for (const planned of analysis.creationPlan.topics) {
    const subjKey = `${normalizeKey(planned.examName)}::${normalizeKey(planned.specialtyName)}::${normalizeKey(planned.subjectName)}`;
    const key = `${subjKey}::${normalizeKey(planned.name)}`;
    if (topicIdByKey.has(key)) continue;

    const subjectId = subjectIdByKey.get(subjKey);
    if (!subjectId) {
      return fail(500, `Missing subject for topic "${planned.name}".`);
    }

    const siblings = topicPositions.get(subjectId) ?? [];
    const { data, error } = await admin
      .from("topics")
      .insert({
        subject_id: subjectId,
        name: planned.name,
        position: nextPosition(siblings),
      })
      .select("id")
      .single();

    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from("topics")
        .select("id")
        .eq("subject_id", subjectId)
        .eq("name", planned.name)
        .maybeSingle();
      if (!existing) return fail(500, `Could not create topic "${planned.name}".`);
      topicIdByKey.set(key, existing.id);
      continue;
    }
    if (error || !data) {
      return fail(500, `Could not create topic "${planned.name}".`);
    }

    topicIdByKey.set(key, data.id);
    topicPositions.set(subjectId, [...siblings, { position: siblings.length }]);
    createdTopics.push(`${planned.subjectName} › ${planned.name}`);
    await audit(user.id, "topic.create", data.id, {
      name: planned.name,
      subjectId,
      via: "bulk_import",
    });
  }

  // ── Patch placeholder topic ids with the real ones ──────────
  type InsertableRow = (typeof analysis.validRows)[number] & { topicId: string };
  const rows: InsertableRow[] = [];
  for (const row of analysis.validRows) {
    let topicId = row.input.topicId;
    if (topicId === PLACEHOLDER_TOPIC_ID) {
      const key = `${normalizeKey(row.examName)}::${normalizeKey(row.specialtyName)}::${normalizeKey(row.subjectName)}::${normalizeKey(row.topicName)}`;
      const resolved = topicIdByKey.get(key);
      if (!resolved) {
        return fail(500, `Could not resolve topic for row ${row.rowNumber}.`);
      }
      topicId = resolved;
    }
    rows.push({ ...row, topicId });
  }

  // ── Chunked inserts with all-or-nothing compensation ────────
  // Hard-deleting on failure is safe here for three reasons: the questions
  // were inserted THIS request, they are drafts (is_published: false), and
  // nothing can reference them yet (tests only ever pick published
  // questions, and question_options cascades on delete).
  const insertedQuestionIds: string[] = [];

  const compensate = async (): Promise<string | null> => {
    if (insertedQuestionIds.length === 0) return null;
    const { error } = await admin
      .from("questions")
      .delete()
      .in("id", insertedQuestionIds);
    return error
      ? `${insertedQuestionIds.length} draft question(s) may remain without options — check the Drafts filter and delete them.`
      : null;
  };

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    const questionRows = chunk.map((row) => ({
      id: crypto.randomUUID(),
      topic_id: row.topicId,
      type: row.input.type,
      difficulty: row.input.difficulty,
      stem: row.input.stem,
      explanation: row.input.explanation,
      image_path: null,
      is_published: false, // drafts, always — publishing stays a deliberate act
      created_by: user.id,
      updated_at: now,
    }));

    const { error: questionsError } = await admin
      .from("questions")
      .insert(questionRows);

    if (questionsError) {
      const leftover = await compensate();
      return fail(
        500,
        leftover
          ? `Import failed while inserting questions. ${leftover}`
          : "Import failed while inserting questions — nothing was kept."
      );
    }
    insertedQuestionIds.push(...questionRows.map((q) => q.id));

    const optionRows = chunk.flatMap((row, index) =>
      diffOptions(questionRows[index].id, [], row.input.options).rows
    );

    const { error: optionsError } = await admin
      .from("question_options")
      .insert(optionRows);

    if (optionsError) {
      const leftover = await compensate();
      return fail(
        500,
        leftover
          ? `Import failed while inserting options. ${leftover}`
          : "Import failed while inserting options — nothing was kept."
      );
    }
  }

  await audit(user.id, "question.bulk_import", null, {
    imported: insertedQuestionIds.length,
    fileName: result.fileName,
    fileSha256: result.fileSha256,
    createdExams,
    createdSpecialties,
    createdSubjects,
    createdTopics,
    errorRows: analysis.counts.errorRows,
    skipped: analysis.counts.skipped,
  });

  revalidatePath("/admin/questions");
  revalidatePath("/admin/subjects");
  revalidatePath("/admin/exams");

  return NextResponse.json<ImportCommitResponse>({
    ok: true,
    imported: insertedQuestionIds.length,
    createdExams,
    createdSpecialties,
    createdSubjects,
    createdTopics,
  });
}

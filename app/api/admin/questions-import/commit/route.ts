import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  examInScope,
  requireContentAuthorJson,
  scopeOrgId,
} from "@/lib/admin/content-scope";
import { audit } from "@/lib/admin/audit";
import {
  analyzeUpload,
  deleteImportObject,
  deleteUploadedImages,
  uploadRowImages,
} from "@/lib/admin/import";
import type { ImportCommitResponse, ImportReport } from "@/lib/admin/import-api";
import {
  PLACEHOLDER_SUBJECT_ID,
  normalizeKey,
  type ImportAnalysis,
} from "@/lib/admin/import-core";
import { diffOptions } from "@/lib/admin/option-diff";
import { listHierarchy, nextPosition } from "@/lib/admin/taxonomy";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";

const UNIQUE_VIOLATION = "23505";

/**
 * Rows per insert round-trip. Each chunk costs two sequential calls
 * (questions, then their options), so this is the main lever on how long a
 * full-cap import takes: at 2000 rows, 250 means 16 round-trips instead of
 * the 40 that 100 would cost.
 */
const CHUNK_SIZE = 250;

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
 * JSON: { objectPath, examId, autoCreate, fileName, fileSha256 }
 *
 * Re-parses and re-validates the file from scratch (same code path as
 * preview), creates any planned specialties/subjects under the forced exam,
 * uploads any images the sheet carries, then inserts every valid row as a
 * DRAFT question. All-or-nothing: any insert failure deletes everything this
 * request created — questions AND the image objects it added.
 */

/**
 * The all-or-nothing guarantee below depends on this handler SURVIVING to run
 * `compensate()`. A platform timeout kills the process instead, leaving
 * orphaned drafts and no error — so this must stay comfortably above the
 * worst-case run: a full IMPORT_ROW_CAP file, re-parsed, plus one round-trip
 * per newly created taxonomy row and per image (bounded by IMPORT_IMAGE_CAP,
 * six at a time). 60s is Vercel's Hobby ceiling and within Pro's, so it is
 * safe on either plan.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await requireContentAuthorJson();
  if ("response" in gate) return gate.response;
  const { user, scope } = gate.author;
  const orgId = scopeOrgId(scope);

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return fail(400, "Invalid request.");

  const expectedSha = String(body.fileSha256 ?? "");
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    return fail(400, "Run preview first — the commit is missing its file fingerprint.");
  }

  const examIdParsed = uuid().safeParse(String(body.examId ?? ""));
  if (!examIdParsed.success) {
    return fail(400, "Open import from an exam page — examId is required.");
  }

  const admin = createAdminClient();
  // Scope pin: an org author imports into their own bank only — "not yours"
  // and "gone" are deliberately the same answer.
  if (!(await examInScope(admin, examIdParsed.data, scope))) {
    return fail(404, "That exam no longer exists.");
  }
  const { data: exam } = await admin
    .from("exams")
    .select("id, name")
    .eq("id", examIdParsed.data)
    .maybeSingle();
  if (!exam) return fail(404, "That exam no longer exists.");

  const objectPath = String(body.objectPath ?? "");
  const fileName = String(body.fileName ?? "");
  const autoCreate = body.autoCreate === true;
  const result = await analyzeUpload(objectPath, autoCreate, {
    id: exam.id,
    name: exam.name,
  });
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
  // Exam-scoped import never creates exams — the exam was chosen on the page.
  if (analysis.creationPlan.exams.length > 0) {
    return fail(
      422,
      "This import cannot create exams. Remove other exam names from the sheet.",
      reportOf(analysis)
    );
  }

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
  const specialtyPositions = new Map<string, { position: number }[]>();
  const subjectPositions = new Map<string, { position: number }[]>();

  for (const hierarchyExam of hierarchy) {
    const examNorm = normalizeKey(hierarchyExam.name);
    examIdByNorm.set(examNorm, hierarchyExam.id);
    for (const sp of hierarchyExam.specialties) {
      const specKey = `${examNorm}::${normalizeKey(sp.name)}`;
      specialtyIdByKey.set(specKey, sp.id);
      specialtyPositions.set(
        hierarchyExam.id,
        [
          ...(specialtyPositions.get(hierarchyExam.id) ?? []),
          { position: sp.position },
        ]
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
      }
    }
  }

  const createdSpecialties: string[] = [];
  const createdSubjects: string[] = [];

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
    await audit(
      user.id,
      "specialty.create",
      data.id,
      { name: planned.name, examId, via: "bulk_import" },
      orgId
    );
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
    await audit(
      user.id,
      "subject.create",
      data.id,
      { name: planned.name, specialtyId, via: "bulk_import" },
      orgId
    );
  }

  // ── Patch placeholder subject ids with the real ones ────────
  type InsertableRow = (typeof analysis.validRows)[number] & {
    subjectId: string;
  };
  const rows: InsertableRow[] = [];
  for (const row of analysis.validRows) {
    let subjectId = row.input.subjectId;
    if (subjectId === PLACEHOLDER_SUBJECT_ID) {
      const key = `${normalizeKey(row.examName)}::${normalizeKey(row.specialtyName)}::${normalizeKey(row.subjectName)}`;
      const resolved = subjectIdByKey.get(key);
      if (!resolved) {
        return fail(500, `Could not resolve subject for row ${row.rowNumber}.`);
      }
      subjectId = resolved;
    }
    rows.push({ ...row, subjectId });
  }

  // ── Upload images before any question exists ────────────────
  // Deliberately ahead of the insert loop: a picture that cannot be saved
  // should stop the import outright rather than leave half the batch with
  // images and half without. Objects created here are tracked so a later
  // insert failure can undo them too.
  const uploaded = await uploadRowImages(rows, result.images);

  if (uploaded.failures.length > 0) {
    await deleteUploadedImages(uploaded.created);
    const [first] = uploaded.failures;
    return fail(
      422,
      uploaded.failures.length === 1
        ? `Row ${first.rowNumber}: ${first.message} Nothing was imported.`
        : `${uploaded.failures.length} images could not be saved (row ${first.rowNumber}: ${first.message}) Nothing was imported.`,
      reportOf(analysis)
    );
  }

  // ── Chunked inserts with all-or-nothing compensation ────────
  // Hard-deleting on failure is safe here for three reasons: the questions
  // were inserted THIS request, they are drafts (is_published: false), and
  // nothing can reference them yet (tests only ever pick published
  // questions, and question_options cascades on delete).
  const insertedQuestionIds: string[] = [];

  const compensate = async (): Promise<string | null> => {
    // Only paths this request CREATED — a content-addressed path that already
    // existed is shared with an earlier import, and deleting it would blank
    // the image on live questions.
    await deleteUploadedImages(uploaded.created);
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
      subject_id: row.subjectId,
      type: row.input.type,
      difficulty: row.input.difficulty,
      stem: row.input.stem,
      explanation: row.input.explanation,
      image_path: uploaded.pathByRow.get(row.rowNumber) ?? null,
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

  await audit(
    user.id,
    "question.bulk_import",
    null,
    {
      imported: insertedQuestionIds.length,
      fileName,
      fileSha256: result.fileSha256,
      examId: exam.id,
      createdSpecialties,
      createdSubjects,
      errorRows: analysis.counts.errorRows,
      skipped: analysis.counts.skipped,
      images: uploaded.pathByRow.size,
      imagesUploaded: uploaded.created.length,
    },
    orgId
  );

  // The workbook has served its purpose; nothing reads it again.
  await deleteImportObject(objectPath);

  revalidatePath("/admin/questions");
  revalidatePath("/admin/subjects");
  revalidatePath("/admin/exams");

  return NextResponse.json<ImportCommitResponse>({
    ok: true,
    imported: insertedQuestionIds.length,
    images: uploaded.pathByRow.size,
    createdExams: [],
    createdSpecialties,
    createdSubjects,
  });
}

"use client";

import { useActionState, useState } from "react";
import {
  AlignLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  addLesson,
  addModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  renameModule,
  reorderLesson,
  reorderModule,
  restoreCourse,
  setCourseStatus,
  updateCourseMeta,
  updateLesson,
} from "@/app/admin/courses/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type {
  BuilderCourse,
  BuilderLesson,
  BuilderModule,
} from "@/lib/admin/courses";
import { DEFAULT_PASS_PCT, fileKindOf } from "@/lib/courses-core";
import type { CourseLessonKind } from "@/lib/supabase/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/auth/form-parts";
import {
  AdminField,
  AdminSelect,
  AdminSubmit,
  AdminTextarea,
} from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";
import {
  CourseFileUpload,
  type UploadedFile,
} from "@/components/admin/course-file-upload";
import { CourseQuizEditor } from "@/components/admin/course-quiz-editor";
import { Markdown } from "@/components/markdown";

const KIND_META: Record<CourseLessonKind, { label: string; icon: LucideIcon }> = {
  video: { label: "Video", icon: Video },
  image: { label: "Image", icon: ImageIcon },
  text: { label: "Text", icon: AlignLeft },
  pdf: { label: "PDF", icon: FileText },
  quiz: { label: "Quiz", icon: ListChecks },
};

export function CourseBuilder({
  builder,
  coverUrl,
}: {
  builder: BuilderCourse;
  coverUrl: string | null;
}) {
  const { course, modules, publishProblems } = builder;

  return (
    <div className="space-y-6">
      {course.status === "published" && course.deleted_at === null && (
        <Alert>
          <AlertTitle>This course is live</AlertTitle>
          <AlertDescription>
            Changes appear to learners immediately — there is no separate
            draft copy once a course is published.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <MetaCard courseId={course.id} builder={builder} coverUrl={coverUrl} />
        <StatusCard builder={builder} publishProblems={publishProblems} />
      </div>

      <AddModuleForm courseId={course.id} />

      {modules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No modules yet. A course is ordered modules of lessons — add the
            first module above.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {modules.map((module, index) => (
            <ModuleCard
              key={module.id}
              courseId={course.id}
              module={module}
              index={index}
              isFirst={index === 0}
              isLast={index === modules.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── course meta + status ────────────────────────────────────

function MetaCard({
  courseId,
  builder,
  coverUrl,
}: {
  courseId: string;
  builder: BuilderCourse;
  coverUrl: string | null;
}) {
  const { course } = builder;
  const [state, action] = useActionState<AdminState, FormData>(
    updateCourseMeta,
    null
  );
  const [cover, setCover] = useState<UploadedFile | null>(
    course.cover_path ? { path: course.cover_path, size: 0 } : null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Course details</h2>
        <FormMessage error={state?.error} success={state?.success} />
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={courseId} />
          <input type="hidden" name="coverPath" value={cover?.path ?? ""} />
          <AdminField
            label="Title"
            name="title"
            defaultValue={course.title}
            required
          />
          <AdminTextarea
            label="Description (markdown)"
            name="description"
            rows={4}
            defaultValue={course.description}
            hint="Shown on the catalog card and the course overview."
          />
          <CourseFileUpload
            label="Cover image"
            target={{ kind: "cover", courseId }}
            value={cover}
            onChange={setCover}
            previewUrl={coverUrl}
          />
          <AdminSubmit>Save details</AdminSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusCard({
  builder,
  publishProblems,
}: {
  builder: BuilderCourse;
  publishProblems: string[];
}) {
  const { course } = builder;
  const [statusState, statusAction] = useActionState<AdminState, FormData>(
    setCourseStatus,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    course.deleted_at ? restoreCourse : deleteCourse,
    null
  );
  const published = course.status === "published";

  return (
    <Card className="h-fit [--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Status</h2>
          {course.deleted_at ? (
            <Badge variant="destructive">Deleted</Badge>
          ) : (
            <Badge variant={published ? "default" : "secondary"}>
              {published ? "Published" : "Draft"}
            </Badge>
          )}
        </div>

        <FormMessage
          error={statusState?.error ?? deleteState?.error}
          success={statusState?.success ?? deleteState?.success}
        />

        {!published && publishProblems.length > 0 && (
          <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-xs font-semibold">Before you can publish:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {publishProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        <form action={statusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={course.id} />
          {published ? (
            <AdminSubmit
              variant="outline-muted"
              name="status"
              value="draft"
            >
              Unpublish
            </AdminSubmit>
          ) : (
            <AdminSubmit
              name="status"
              value="published"
              disabled={publishProblems.length > 0 || course.deleted_at !== null}
            >
              Publish course
            </AdminSubmit>
          )}
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="id" value={course.id} />
          {course.deleted_at ? (
            <AdminSubmit variant="outline-muted" size="sm">
              Restore course
            </AdminSubmit>
          ) : (
            <ConfirmSubmit
              variant="outline-muted"
              size="sm"
              title={`Delete “${course.title}”?`}
              confirmLabel="Delete course"
              description="The course disappears from the catalog and learners' dashboards. Progress is kept, and you can restore it from the deleted filter."
            >
              <Trash2 data-icon="inline-start" />
              Delete course
            </ConfirmSubmit>
          )}
        </form>

        {published && (
          <p className="text-xs text-muted-foreground">
            Adding a quiz to an early module can re-lock later modules for
            learners already past it — they keep their progress and re-unlock
            by passing it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── modules ─────────────────────────────────────────────────

function AddModuleForm({ courseId }: { courseId: string }) {
  const [state, action] = useActionState<AdminState, FormData>(addModule, null);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <h2 className="font-display text-lg">Add a module</h2>
        <FormMessage error={state?.error} success={state?.success} />
        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="courseId" value={courseId} />
          <Input
            name="title"
            placeholder="e.g. Module 1 — Foundations"
            required
            className="h-10 max-w-sm flex-1"
          />
          <AdminSubmit>
            <Plus data-icon="inline-start" />
            Add module
          </AdminSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

function ReorderButtons({
  id,
  action,
  isFirst,
  isLast,
  what,
}: {
  id: string;
  action: (prev: AdminState, fd: FormData) => Promise<AdminState>;
  isFirst: boolean;
  isLast: boolean;
  what: string;
}) {
  const [, dispatch] = useActionState<AdminState, FormData>(action, null);

  return (
    <form action={dispatch} className="flex gap-0.5">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        name="direction"
        value="up"
        variant="ghost"
        size="icon"
        disabled={isFirst}
        aria-label={`Move ${what} up`}
      >
        <ChevronUp aria-hidden />
      </Button>
      <Button
        type="submit"
        name="direction"
        value="down"
        variant="ghost"
        size="icon"
        disabled={isLast}
        aria-label={`Move ${what} down`}
      >
        <ChevronDown aria-hidden />
      </Button>
    </form>
  );
}

function ModuleCard({
  courseId,
  module,
  index,
  isFirst,
  isLast,
}: {
  courseId: string;
  module: BuilderModule;
  index: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameModule,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteModule,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            Module {index + 1}
          </span>
          <form action={renameAction} className="flex min-w-0 flex-1 gap-2">
            <input type="hidden" name="id" value={module.id} />
            <Input
              name="title"
              defaultValue={module.title}
              aria-label={`Module ${index + 1} title`}
              className="h-9 max-w-sm"
            />
            <AdminSubmit variant="ghost" size="sm">
              Rename
            </AdminSubmit>
          </form>
          <ReorderButtons
            id={module.id}
            action={reorderModule}
            isFirst={isFirst}
            isLast={isLast}
            what={`module ${index + 1}`}
          />
          <form action={deleteAction}>
            <input type="hidden" name="id" value={module.id} />
            <ConfirmSubmit
              title={`Delete “${module.title}”?`}
              confirmLabel="Delete module"
              description="Its lessons disappear from the syllabus for everyone; learner progress rows are kept but stop counting."
              triggerLabel={`Delete module ${index + 1}`}
            >
              <Trash2 aria-hidden />
            </ConfirmSubmit>
          </form>
        </div>
        <FormMessage
          error={renameState?.error ?? deleteState?.error}
          success={renameState?.success ?? deleteState?.success}
        />

        {module.lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lessons in this module yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {module.lessons.map((lesson, li) => (
              <LessonRow
                key={lesson.id}
                courseId={courseId}
                lesson={lesson}
                isFirst={li === 0}
                isLast={li === module.lessons.length - 1}
              />
            ))}
          </ul>
        )}

        <AddLessonForm moduleId={module.id} />
      </CardContent>
    </Card>
  );
}

// ── lessons ─────────────────────────────────────────────────

function AddLessonForm({ moduleId }: { moduleId: string }) {
  const [state, action] = useActionState<AdminState, FormData>(addLesson, null);

  return (
    <div className="space-y-2 border-t pt-3">
      <FormMessage error={state?.error} success={state?.success} />
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="moduleId" value={moduleId} />
        <AdminSelect
          label="Add lesson"
          name="kind"
          id={`kind-${moduleId}`}
          className="w-28"
        >
          {Object.entries(KIND_META).map(([kind, meta]) => (
            <option key={kind} value={kind}>
              {meta.label}
            </option>
          ))}
        </AdminSelect>
        <Input
          name="title"
          placeholder="Lesson title"
          required
          className="h-10 max-w-xs flex-1"
        />
        <AdminSubmit variant="outline-muted">
          <Plus data-icon="inline-start" />
          Add
        </AdminSubmit>
      </form>
    </div>
  );
}

function lessonHint(lesson: BuilderLesson): string | null {
  if (fileKindOf(lesson.kind) && !lesson.file_path) return "No file uploaded";
  if (lesson.kind === "quiz") {
    if (lesson.questions.length === 0) return "No questions";
    return `${lesson.questions.length} question${lesson.questions.length === 1 ? "" : "s"} · pass ${lesson.pass_pct ?? DEFAULT_PASS_PCT}%`;
  }
  return null;
}

function LessonRow({
  courseId,
  lesson,
  isFirst,
  isLast,
}: {
  courseId: string;
  lesson: BuilderLesson;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteLesson,
    null
  );
  const { icon: Icon, label } = KIND_META[lesson.kind];
  const hint = lessonHint(lesson);

  return (
    <li className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lesson.title}</p>
          <p className="text-xs text-muted-foreground">
            {label}
            {hint && (
              <>
                {" · "}
                <span
                  className={
                    hint.startsWith("No") ? "text-destructive" : undefined
                  }
                >
                  {hint}
                </span>
              </>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Edit"}
        </Button>
        <ReorderButtons
          id={lesson.id}
          action={reorderLesson}
          isFirst={isFirst}
          isLast={isLast}
          what={lesson.title}
        />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={lesson.id} />
          <ConfirmSubmit
            title={`Delete “${lesson.title}”?`}
            confirmLabel="Delete lesson"
            description="It disappears from the syllabus for everyone. Learner progress rows are kept but stop counting."
            triggerLabel={`Delete ${lesson.title}`}
          >
            <Trash2 aria-hidden />
          </ConfirmSubmit>
        </form>
      </div>
      {deleteState?.error && (
        <p className="px-3 pb-2 text-xs text-destructive">{deleteState.error}</p>
      )}

      {open && (
        <div className="space-y-4 border-t bg-muted/20 p-3">
          <LessonEditor courseId={courseId} lesson={lesson} />
          {lesson.kind === "quiz" && (
            <CourseQuizEditor lessonId={lesson.id} questions={lesson.questions} />
          )}
        </div>
      )}
    </li>
  );
}

function LessonEditor({
  courseId,
  lesson,
}: {
  courseId: string;
  lesson: BuilderLesson;
}) {
  const [state, action] = useActionState<AdminState, FormData>(
    updateLesson,
    null
  );
  const [file, setFile] = useState<UploadedFile | null>(
    lesson.file_path
      ? { path: lesson.file_path, size: lesson.file_size ?? 0 }
      : null
  );
  const [preview, setPreview] = useState(false);
  const [bodyMd, setBodyMd] = useState(lesson.body_md ?? "");
  const fileKind = fileKindOf(lesson.kind);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={lesson.id} />
      <input type="hidden" name="kind" value={lesson.kind} />
      <input type="hidden" name="filePath" value={file?.path ?? ""} />
      <input type="hidden" name="fileSize" value={file?.size ?? ""} />

      <FormMessage error={state?.error} success={state?.success} />

      <AdminField
        label="Title"
        name="title"
        id={`title-${lesson.id}`}
        defaultValue={lesson.title}
        required
      />

      {fileKind && (
        <CourseFileUpload
          label={`${KIND_META[lesson.kind].label} file`}
          target={{ kind: "lesson", courseId, lessonId: lesson.id, fileKind }}
          value={file}
          onChange={setFile}
        />
      )}

      {lesson.kind === "quiz" && (
        <AdminField
          label="Pass mark (%)"
          name="passPct"
          id={`pass-${lesson.id}`}
          type="number"
          min={1}
          max={100}
          defaultValue={lesson.pass_pct ?? DEFAULT_PASS_PCT}
          className="max-w-32"
          hint="Score needed to pass and unlock the next module."
        />
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {lesson.kind === "text"
              ? "Lesson text (markdown)"
              : "Intro text (markdown, optional)"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? "Write" : "Preview"}
          </Button>
        </div>
        {preview ? (
          <div className="min-h-24 rounded-lg border bg-background px-3 py-2">
            {bodyMd.trim() === "" ? (
              <p className="text-sm text-muted-foreground">Nothing to preview.</p>
            ) : (
              <Markdown>{bodyMd}</Markdown>
            )}
          </div>
        ) : (
          <textarea
            name="bodyMd"
            aria-label="Lesson text"
            rows={lesson.kind === "text" ? 10 : 4}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        )}
        {/* Keep the value posted while previewing (textarea unmounts). */}
        {preview && <input type="hidden" name="bodyMd" value={bodyMd} />}
      </div>

      <AdminSubmit size="sm">Save lesson</AdminSubmit>
    </form>
  );
}

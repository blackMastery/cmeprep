import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Download, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getLessonView, type LessonView } from "@/lib/courses";
import { DEFAULT_PASS_PCT } from "@/lib/courses-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { MarkCompleteButton } from "@/components/course/mark-complete-button";
import { QuizRunner } from "@/components/course/quiz-runner";
import { Syllabus } from "@/components/course/syllabus";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const user = await requireUser();
  const { id, lessonId } = await params;
  const view = await getLessonView(id, lessonId, user.id);
  if (!view) notFound();

  const { tree, lesson, locked } = view;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href={`/cme/${tree.course.id}`}>
          <ArrowLeft data-icon="inline-start" />
          {tree.course.title}
        </Link>
      </Button>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        {/* Syllabus rail — becomes a stacked section below the lesson on
            small screens rather than a sheet; courses are read-mostly. */}
        <aside className="order-2 lg:order-1">
          <Syllabus tree={tree} currentLessonId={lesson.id} compact />
        </aside>

        <main className="order-1 min-w-0 lg:order-2">
          <header className="mb-4">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {lesson.title}
            </h1>
          </header>

          {locked ? <LockedNotice /> : <LessonContent view={view} />}

          <PrevNext view={view} />
        </main>
      </div>
    </div>
  );
}

function LockedNotice() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
      <Lock className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">This module is locked</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Pass the quiz in the earlier module to unlock it. Your progress here
          is kept if the course changes.
        </p>
      </CardContent>
    </Card>
  );
}

function LessonContent({ view }: { view: LessonView }) {
  const { tree, lesson, fileUrl } = view;

  return (
    <div className="space-y-5">
      {/* Intro text sits above the media for every kind; for kind='text'
          body_md IS the lesson. */}
      {lesson.body_md && lesson.kind !== "quiz" && (
        <Markdown>{lesson.body_md}</Markdown>
      )}

      {lesson.kind === "video" &&
        (fileUrl ? (
          <video
            controls
            preload="metadata"
            src={fileUrl}
            className="w-full rounded-xl border bg-black"
          >
            Your browser can&apos;t play this video.
          </video>
        ) : (
          <MissingFile />
        ))}

      {lesson.kind === "image" &&
        (fileUrl ? (
          // Signed URL, changes every render; next/image caching fights it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl}
            alt={lesson.title}
            className="w-full rounded-xl border"
          />
        ) : (
          <MissingFile />
        ))}

      {lesson.kind === "pdf" &&
        (fileUrl ? (
          <div className="space-y-2">
            <iframe
              src={fileUrl}
              title={lesson.title}
              className="h-[70vh] w-full rounded-xl border"
            />
            <Button variant="outline-muted" size="sm" asChild>
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <Download data-icon="inline-start" />
                Open the PDF in a new tab
              </a>
            </Button>
          </div>
        ) : (
          <MissingFile />
        ))}

      {lesson.kind === "quiz" ? (
        <>
          {lesson.body_md && <Markdown>{lesson.body_md}</Markdown>}
          <QuizRunner
            courseId={tree.course.id}
            lessonId={lesson.id}
            questions={view.quiz ?? []}
            passPct={lesson.pass_pct ?? DEFAULT_PASS_PCT}
            alreadyPassed={view.completed}
            attempts={view.attempts}
          />
        </>
      ) : (
        <MarkCompleteButton
          courseId={tree.course.id}
          lessonId={lesson.id}
          completed={view.completed}
        />
      )}
    </div>
  );
}

function MissingFile() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        This lesson&apos;s file isn&apos;t available right now.
      </CardContent>
    </Card>
  );
}

function PrevNext({ view }: { view: LessonView }) {
  const { tree, prevLessonId, nextLessonId } = view;
  if (!prevLessonId && !nextLessonId) return null;

  return (
    <div className="mt-8 flex items-center justify-between gap-3 border-t pt-4">
      {prevLessonId ? (
        <Button variant="outline-muted" size="sm" asChild>
          <Link href={`/cme/${tree.course.id}/lessons/${prevLessonId}`}>
            <ArrowLeft data-icon="inline-start" />
            Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {nextLessonId && (
        <Button variant="outline-muted" size="sm" asChild>
          <Link href={`/cme/${tree.course.id}/lessons/${nextLessonId}`}>
            Next
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </div>
  );
}

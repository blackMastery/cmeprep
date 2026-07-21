"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import type { ExamHierarchy } from "@/lib/admin/taxonomy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Plain GET form — no debounced client state. Keeps the list server-rendered,
 * shareable by URL, and working without JS.
 */
export function QuestionFilters({
  hierarchy,
}: {
  hierarchy: ExamHierarchy[];
}) {
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";

  const specialties = hierarchy.flatMap((exam) =>
    exam.specialties.map((s) => ({ ...s, examName: exam.name }))
  );

  return (
    <form
      method="get"
      action="/admin/questions"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          name="q"
          type="search"
          defaultValue={get("q")}
          placeholder="Search stems and explanations…"
          aria-label="Search questions"
          className="h-9 pl-8"
        />
      </div>

      {/* Only rendered once a second exam/specialty exists — with a single
          one they filter nothing and just widen the bar. */}
      {hierarchy.length > 1 && (
        <select
          name="exam"
          defaultValue={get("exam")}
          aria-label="Exam"
          className={SELECT_CLASS}
        >
          <option value="">All exams</option>
          {hierarchy.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}

      {specialties.length > 1 && (
        <select
          name="specialty"
          defaultValue={get("specialty")}
          aria-label="Specialty"
          className={SELECT_CLASS}
        >
          <option value="">All specialties</option>
          {hierarchy.map((e) => (
            <optgroup key={e.id} label={e.name}>
              {e.specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      <select
        name="subject"
        defaultValue={get("subject")}
        aria-label="Subject"
        className={SELECT_CLASS}
      >
        <option value="">All subjects</option>
        {specialties.map((s) => (
          <optgroup
            key={s.id}
            label={
              hierarchy.length > 1 ? `${s.examName} › ${s.name}` : s.name
            }
          >
            {s.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        name="topic"
        defaultValue={get("topic")}
        aria-label="Topic"
        className={SELECT_CLASS}
      >
        <option value="">All topics</option>
        {specialties.flatMap((s) =>
          s.subjects.map((subject) => (
            <optgroup
              key={subject.id}
              label={
                specialties.length > 1
                  ? `${s.name} › ${subject.name}`
                  : subject.name
              }
            >
              {subject.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))
        )}
      </select>

      <select
        name="difficulty"
        defaultValue={get("difficulty")}
        aria-label="Difficulty"
        className={SELECT_CLASS}
      >
        <option value="">Any difficulty</option>
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>

      <select
        name="type"
        defaultValue={get("type")}
        aria-label="Type"
        className={SELECT_CLASS}
      >
        <option value="">Any type</option>
        <option value="mcq_single">Single answer</option>
        <option value="mcq_multi">Multi answer</option>
        <option value="image_based">Image based</option>
      </select>

      <select
        name="published"
        defaultValue={get("published")}
        aria-label="Status"
        className={SELECT_CLASS}
      >
        <option value="">Any status</option>
        <option value="true">Published</option>
        <option value="false">Draft</option>
      </select>

      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="includeDeleted"
          value="1"
          defaultChecked={get("includeDeleted") === "1"}
          className="size-4 accent-[var(--primary)]"
        />
        Deleted
      </label>

      <Button type="submit" size="sm">
        Filter
      </Button>
      <Button variant="ghost" size="sm" type="button" asChild>
        <Link href="/admin/questions">Reset</Link>
      </Button>
    </form>
  );
}

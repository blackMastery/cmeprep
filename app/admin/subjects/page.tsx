import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { DEFAULT_SPECIALTY_ID } from "@/lib/taxonomy-defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SubjectManager } from "@/components/admin/subject-manager";

export const metadata: Metadata = { title: "Subjects & topics" };

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function AdminSubjectsPage(
  props: PageProps<"/admin/subjects">
) {
  const sp = await props.searchParams;
  const hierarchy = await listHierarchy();

  const specialties = hierarchy.flatMap((exam) =>
    exam.specialties.map((s) => ({ ...s, examName: exam.name }))
  );

  if (specialties.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
              <GraduationCap className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-lg">No specialties yet</h1>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Subjects live inside a specialty, and specialties inside an
                exam. Create those first.
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/exams">Set up exams &amp; specialties</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const requested = one(sp.specialty);
  const active =
    specialties.find((s) => s.id === requested) ??
    specialties.find((s) => s.id === DEFAULT_SPECIALTY_ID) ??
    specialties[0];

  // Cross-specialty move destinations, labelled so same-named subjects in
  // different specialties stay distinguishable.
  const moveGroups = specialties.flatMap((spec) =>
    spec.subjects.map((subject) => ({
      label: `${spec.name} › ${subject.name}`,
      topics: subject.topics.map((t) => ({ id: t.id, name: t.name })),
    }))
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Subjects &amp; topics
        </h1>
        <p className="mt-1 text-muted-foreground">
          {active.examName} › {active.name} — questions live under a topic,
          topics under a subject.
        </p>
      </header>

      <form
        method="get"
        className="mb-6 flex flex-wrap items-center gap-2"
        aria-label="Choose specialty"
      >
        <label htmlFor="specialty-picker" className="text-sm font-medium">
          Specialty
        </label>
        <select
          id="specialty-picker"
          name="specialty"
          defaultValue={active.id}
          className="h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm"
        >
          {hierarchy.map((exam) => (
            <optgroup key={exam.id} label={exam.name}>
              {exam.specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Button type="submit" variant="outline-muted" size="sm">
          Switch
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/exams">Manage exams</Link>
        </Button>
      </form>

      <SubjectManager
        subjects={active.subjects}
        specialtyId={active.id}
        moveGroups={moveGroups}
      />
    </div>
  );
}

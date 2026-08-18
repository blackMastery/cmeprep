import type { Metadata } from "next";
import { listCoursesForAdmin } from "@/lib/admin/courses";
import { CoursesTable } from "@/components/admin/courses-table";

export const metadata: Metadata = { title: "CME" };

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const showingDeleted = deleted === "1";
  const items = await listCoursesForAdmin({ includeDeleted: showingDeleted });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Continuing Medical Education
        </p>
        <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight">
          CME
        </h1>
        <p className="mt-1 text-muted-foreground">
          Structured CME content — modules of video, text, PDF and image
          lessons with quizzes that gate progression. Free for every signed-in
          user.
        </p>
      </header>

      <CoursesTable items={items} showingDeleted={showingDeleted} />
    </div>
  );
}

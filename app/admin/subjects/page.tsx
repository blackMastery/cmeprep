import type { Metadata } from "next";
import { listTaxonomy } from "@/lib/admin/taxonomy";
import { SubjectManager } from "@/components/admin/subject-manager";

export const metadata: Metadata = { title: "Subjects & topics" };

export default async function AdminSubjectsPage() {
  const taxonomy = await listTaxonomy();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Subjects &amp; topics
        </h1>
        <p className="mt-1 text-muted-foreground">
          Questions live under a topic, and topics under a subject. Students
          build tests by picking from this tree.
        </p>
      </header>

      <SubjectManager subjects={taxonomy} />
    </div>
  );
}

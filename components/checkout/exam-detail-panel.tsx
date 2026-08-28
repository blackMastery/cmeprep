import type {
  CatalogExamDetail,
  CatalogSpecialty,
} from "@/lib/catalog-core";
import { SpecialtyDisclosure } from "@/components/checkout/specialty-disclosure";

/**
 * What an exam actually contains, for someone deciding whether to buy it.
 *
 * Two clicks to the whole syllabus: the stat grid and specialty list render
 * as soon as an exam is selected, and one disclosure per specialty reveals
 * its subjects. Subjects deliberately do NOT get a second nested expander —
 * two levels of hand-rolled disclosure is fiddly to operate.
 *
 * Question counts are deliberately not shown anywhere here: a buyer should
 * judge coverage by the syllabus, not by a bank size that grows over time.
 *
 * Server component: the tree never enters the client bundle. Only the
 * per-specialty toggle is a client child.
 */
export function ExamDetailPanel({ exam }: { exam: CatalogExamDetail }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-center">
        <Stat label="Specialties" value={exam.specialtyCount} />
        <Stat label="Subjects" value={exam.subjectCount} />
      </dl>

      {exam.specialties.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Content for this examination is being published.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {exam.specialties.map((specialty) => (
            <li key={specialty.id}>
              <SpecialtyDisclosure
                specialty={specialty}
                summary={specialtySummary(specialty)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function specialtySummary(specialty: CatalogSpecialty): string {
  return `${specialty.subjectCount} subject${specialty.subjectCount === 1 ? "" : "s"}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className="font-display text-lg tabular-nums">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

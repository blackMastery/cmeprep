import type { SubjectAccuracy } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";

export function WeakAreas({ subjects }: { subjects: SubjectAccuracy[] }) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">Weak areas</h2>
          <p className="text-xs text-muted-foreground">
            Subjects with at least 5 attempts, lowest accuracy first.
          </p>
        </div>

        {subjects.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Answer a few more questions and your weakest subjects will show up
            here.
          </p>
        ) : (
          <ul className="space-y-3">
            {subjects.map((subject) => (
              <li key={subject.subject_id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{subject.subject_name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {Math.round(subject.accuracy_pct)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${subject.accuracy_pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

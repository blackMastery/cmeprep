"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { useLaunchTest } from "@/components/use-launch-test";
import type { AssignmentStatus } from "@/lib/orgs-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type AssignmentListItem = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  numQuestions: number;
  /** The org's prescribed mode; the member may start in the other one. */
  mode: "exam" | "tutor";
  /** Null exactly when mode='tutor' — tutor prescriptions are untimed. */
  durationMin: number | null;
  status: AssignmentStatus;
  latestTestId: string | null;
  latestScore: number | null;
  latestTotal: number | null;
  /** Mode the qualifying completion was actually done in. */
  completedMode: "exam" | "tutor" | null;
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  completed_late: "Completed late",
  overdue: "Overdue",
};

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: AssignmentStatus }) {
  return (
    <Badge
      variant={
        status === "completed"
          ? "default"
          : status === "overdue"
            ? "destructive"
            : "secondary"
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Launches the prescribed test. The config always comes from the server-side
 * prescription; `mode` is the one member choice — doing an exam assignment
 * as tutor practice (or vice versa) still counts, labeled with the mode used.
 */
function StartButton({
  assignmentId,
  label,
  prescribedMode,
}: {
  assignmentId: string;
  label: string;
  prescribedMode: "exam" | "tutor";
}) {
  const { busy, error, launch } = useLaunchTest();

  const start = (mode?: "exam" | "tutor") =>
    launch({ assignmentId, ...(mode !== undefined ? { mode } : {}) });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={() => start()} disabled={busy} aria-busy={busy}>
        {busy ? "Starting…" : label}
      </Button>
      <button
        type="button"
        onClick={() =>
          start(prescribedMode === "tutor" ? "exam" : "tutor")
        }
        disabled={busy}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {prescribedMode === "tutor"
          ? "or take it as a timed exam"
          : "or practise it in tutor mode"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AssignmentList({ items }: { items: AssignmentListItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="font-display text-lg">Nothing assigned right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When your organisation assigns a mock or practice set, it shows up
            here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display font-semibold">{item.title}</p>
                  <StatusBadge status={item.status} />
                </div>
                {item.description && (
                  <p className="text-sm text-muted-foreground">
                    {item.description}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  Due {longDate(item.dueAt)} · {item.numQuestions} questions ·{" "}
                  {item.mode === "tutor"
                    ? "tutor mode"
                    : `${item.durationMin} min`}
                  {/* score is a PERCENTAGE, not a correct-answer count —
                      pairing it with the question total read as "70/10". */}
                  {item.latestScore !== null && (
                    <span className="tabular-nums">
                      · latest {item.latestScore}%
                    </span>
                  )}
                  {/* Overrides count, labeled — say how it was actually done. */}
                  {item.completedMode !== null &&
                    item.completedMode !== item.mode && (
                      <span>
                        · done in{" "}
                        {item.completedMode === "tutor" ? "tutor" : "exam"} mode
                      </span>
                    )}
                </p>
              </div>

              {item.status === "in_progress" && item.latestTestId ? (
                <Button asChild>
                  <Link href={`/tests/${item.latestTestId}/take`}>Continue</Link>
                </Button>
              ) : item.status === "completed" ||
                item.status === "completed_late" ? (
                <div className="flex items-center gap-2">
                  {item.latestTestId && (
                    <Button variant="outline" asChild>
                      <Link href={`/tests/${item.latestTestId}/results`}>
                        Results
                      </Link>
                    </Button>
                  )}
                  <StartButton
                    assignmentId={item.id}
                    label="Retake"
                    prescribedMode={item.mode}
                  />
                </div>
              ) : (
                <StartButton
                  assignmentId={item.id}
                  label={item.status === "overdue" ? "Start late" : "Start"}
                  prescribedMode={item.mode}
                />
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

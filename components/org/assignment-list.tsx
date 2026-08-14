"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
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
  durationMin: number;
  status: AssignmentStatus;
  latestTestId: string | null;
  latestScore: number | null;
  latestTotal: number | null;
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

/** Launches the prescribed test — the server ignores everything but the id. */
function StartButton({
  assignmentId,
  label,
}: {
  assignmentId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "Could not start the test.");
        setBusy(false);
        return;
      }
      router.push(`/tests/${data.id}/take`);
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={start} disabled={busy} aria-busy={busy}>
        {busy ? "Starting…" : label}
      </Button>
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
                  {item.durationMin} min
                  {item.latestScore !== null && item.latestTotal !== null && (
                    <span className="tabular-nums">
                      · latest {item.latestScore}/{item.latestTotal}
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
                  <StartButton assignmentId={item.id} label="Retake" />
                </div>
              ) : (
                <StartButton
                  assignmentId={item.id}
                  label={item.status === "overdue" ? "Start late" : "Start"}
                />
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

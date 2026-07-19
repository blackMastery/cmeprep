"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";

type Subject = { id: string; name: string; topics: { id: string; name: string }[] };

const COUNTS = [10, 20, 40, 60];
const DIFFICULTIES = [
  { value: "mixed", label: "Mixed" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

const STEPS = ["Subjects", "Topics", "Format"] as const;

export function NewTestWizard({ subjects }: { subjects: Subject[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [numQuestions, setNumQuestions] = useState(20);
  const [difficulty, setDifficulty] =
    useState<(typeof DIFFICULTIES)[number]["value"]>("mixed");
  const [durationMin, setDurationMin] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTopics = useMemo(
    () =>
      subjects
        .filter((s) => subjectIds.includes(s.id))
        .flatMap((s) => s.topics.map((t) => ({ ...t, subject: s.name }))),
    [subjectIds, subjects]
  );

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function start() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectIds,
          topicIds,
          difficulty,
          numQuestions,
          durationMin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Could not start the test.");
        setSubmitting(false);
        return;
      }
      router.push(`/tests/${data.id}/take`);
    } catch {
      setError("Network error. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const canAdvance =
    (step === 0 && subjectIds.length > 0) || step === 1 || step === 2;

  return (
    <div>
      <header className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Start a new test
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Three quick steps — you&apos;ll be answering in under a minute.
        </p>
      </header>

      <ol className="mb-6 flex items-center justify-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full font-semibold",
                i <= step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            <span className={cn(i === step ? "font-medium" : "text-muted-foreground")}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>

      <Card className="[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-6">
          {step === 0 && (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-display text-lg">
                Which subjects?
              </legend>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    selected={subjectIds.includes(s.id)}
                    onClick={() => {
                      const next = toggle(subjectIds, s.id);
                      setSubjectIds(next);
                      // Drop topics whose subject was just removed.
                      setTopicIds((prev) =>
                        prev.filter((tid) =>
                          subjects
                            .filter((x) => next.includes(x.id))
                            .some((x) => x.topics.some((t) => t.id === tid))
                        )
                      );
                    }}
                  />
                ))}
              </div>
              {subjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No subjects have been published yet.
                </p>
              )}
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="space-y-3">
              <legend className="mb-1 font-display text-lg">
                Narrow to topics?
              </legend>
              <p className="mb-3 text-sm text-muted-foreground">
                Optional — leave empty to cover every topic in your subjects.
              </p>
              <div className="flex flex-wrap gap-2">
                {availableTopics.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    selected={topicIds.includes(t.id)}
                    onClick={() => setTopicIds(toggle(topicIds, t.id))}
                  />
                ))}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <fieldset>
                <legend className="mb-3 font-display text-lg">
                  How many questions?
                </legend>
                <div className="flex flex-wrap gap-2">
                  {COUNTS.map((n) => (
                    <Chip
                      key={n}
                      label={String(n)}
                      selected={numQuestions === n}
                      onClick={() => {
                        setNumQuestions(n);
                        setDurationMin(Math.max(5, Math.round(n * 1.5)));
                      }}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 font-display text-lg">Difficulty</legend>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTIES.map((d) => (
                    <Chip
                      key={d.value}
                      label={d.label}
                      selected={difficulty === d.value}
                      onClick={() => setDifficulty(d.value)}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 font-display text-lg">Time limit</legend>
                <div className="flex flex-wrap gap-2">
                  {[15, 30, 45, 60, 90].map((m) => (
                    <Chip
                      key={m}
                      label={`${m} min`}
                      selected={durationMin === m}
                      onClick={() => setDurationMin(m)}
                    />
                  ))}
                </div>
              </fieldset>

              <EcgDivider className="my-2" />

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Summary label="Subjects" value={String(subjectIds.length)} />
                <Summary
                  label="Topics"
                  value={topicIds.length === 0 ? "All" : String(topicIds.length)}
                />
                <Summary label="Questions" value={String(numQuestions)} />
                <Summary label="Time" value={`${durationMin} min`} />
              </dl>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-5">
            {step > 0 && (
              <Button
                variant="outline-muted"
                onClick={() => setStep(step - 1)}
                disabled={submitting}
              >
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
            )}

            {step < STEPS.length - 1 ? (
              <Button
                className="ml-auto"
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance}
              >
                Continue
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                className="ml-auto"
                size="lg"
                onClick={start}
                disabled={submitting || subjectIds.length === 0}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    Building your test…
                  </>
                ) : (
                  "Start test"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-display text-lg">{value}</dd>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";

type WizardTopic = { id: string; name: string };
type WizardSubject = { id: string; name: string; topics: WizardTopic[] };
type WizardSpecialty = { id: string; name: string; subjects: WizardSubject[] };
export type WizardExam = {
  id: string;
  name: string;
  specialties: WizardSpecialty[];
};

const COUNTS = [10, 20, 40, 60];
const DIFFICULTIES = [
  { value: "mixed", label: "Mixed" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

export function NewTestWizard({ exams }: { exams: WizardExam[] }) {
  const router = useRouter();

  // With a single exam the Exam step disappears entirely — the flow looks
  // exactly like the original three-step wizard until a second exam exists.
  const steps = useMemo(
    () =>
      exams.length > 1
        ? (["Exam", "Subjects", "Topics", "Format"] as const)
        : (["Subjects", "Topics", "Format"] as const),
    [exams.length]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [examId, setExamId] = useState<string | null>(
    exams.length === 1 ? exams[0].id : null
  );
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [numQuestions, setNumQuestions] = useState(20);
  const [difficulty, setDifficulty] =
    useState<(typeof DIFFICULTIES)[number]["value"]>("mixed");
  const [durationMin, setDurationMin] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStep = steps[stepIndex];

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId]
  );

  /** Subjects of the chosen exam, grouped by specialty for the headings. */
  const specialtyGroups = useMemo(
    () =>
      (selectedExam?.specialties ?? []).filter((sp) => sp.subjects.length > 0),
    [selectedExam]
  );
  const examSubjects = useMemo(
    () => specialtyGroups.flatMap((sp) => sp.subjects),
    [specialtyGroups]
  );

  const availableTopics = useMemo(
    () =>
      examSubjects
        .filter((s) => subjectIds.includes(s.id))
        .flatMap((s) => s.topics),
    [subjectIds, examSubjects]
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
          examId,
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
    currentStep === "Exam"
      ? examId !== null
      : currentStep === "Subjects"
        ? subjectIds.length > 0
        : true;

  return (
    <div>
      <header className="mb-6 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Start a new test
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {steps.length === 3
            ? "Three quick steps — you'll be answering in under a minute."
            : "Four quick steps — you'll be answering in under a minute."}
        </p>
      </header>

      <ol className="mb-6 flex items-center justify-center gap-2 text-xs">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full font-semibold",
                i <= stepIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                i === stepIndex ? "font-medium" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>

      <Card className="[--card-spacing:--spacing(6)]">
        <CardContent className="space-y-6">
          {currentStep === "Exam" && (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-display text-lg">
                Which examination are you preparing for?
              </legend>
              <div className="flex flex-wrap gap-2">
                {exams.map((e) => (
                  <Chip
                    key={e.id}
                    label={e.name}
                    selected={examId === e.id}
                    onClick={() => {
                      if (examId !== e.id) {
                        setExamId(e.id);
                        // Selections belong to the previous exam's tree.
                        setSubjectIds([]);
                        setTopicIds([]);
                      }
                    }}
                  />
                ))}
              </div>
            </fieldset>
          )}

          {currentStep === "Subjects" && (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-display text-lg">
                Which subjects?
              </legend>

              {specialtyGroups.length > 1 ? (
                <div className="space-y-4">
                  {specialtyGroups.map((sp) => (
                    <div key={sp.id}>
                      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {sp.name}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sp.subjects.map((s) => (
                          <SubjectChip
                            key={s.id}
                            subject={s}
                            subjectIds={subjectIds}
                            setSubjectIds={setSubjectIds}
                            setTopicIds={setTopicIds}
                            examSubjects={examSubjects}
                            toggle={toggle}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {examSubjects.map((s) => (
                    <SubjectChip
                      key={s.id}
                      subject={s}
                      subjectIds={subjectIds}
                      setSubjectIds={setSubjectIds}
                      setTopicIds={setTopicIds}
                      examSubjects={examSubjects}
                      toggle={toggle}
                    />
                  ))}
                </div>
              )}

              {examSubjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No subjects have been published yet
                  {selectedExam ? ` for ${selectedExam.name}` : ""}.
                </p>
              )}
            </fieldset>
          )}

          {currentStep === "Topics" && (
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

          {currentStep === "Format" && (
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
            {stepIndex > 0 && (
              <Button
                variant="outline-muted"
                onClick={() => setStepIndex(stepIndex - 1)}
                disabled={submitting}
              >
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
            )}

            {stepIndex < steps.length - 1 ? (
              <Button
                className="ml-auto"
                onClick={() => setStepIndex(stepIndex + 1)}
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
                disabled={submitting || examId === null || subjectIds.length === 0}
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

function SubjectChip({
  subject,
  subjectIds,
  setSubjectIds,
  setTopicIds,
  examSubjects,
  toggle,
}: {
  subject: WizardSubject;
  subjectIds: string[];
  setSubjectIds: (ids: string[]) => void;
  setTopicIds: React.Dispatch<React.SetStateAction<string[]>>;
  examSubjects: WizardSubject[];
  toggle: (list: string[], id: string) => string[];
}) {
  return (
    <Chip
      label={subject.name}
      selected={subjectIds.includes(subject.id)}
      onClick={() => {
        const next = toggle(subjectIds, subject.id);
        setSubjectIds(next);
        // Drop topics whose subject was just removed.
        setTopicIds((prev) =>
          prev.filter((tid) =>
            examSubjects
              .filter((x) => next.includes(x.id))
              .some((x) => x.topics.some((t) => t.id === tid))
          )
        );
      }}
    />
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

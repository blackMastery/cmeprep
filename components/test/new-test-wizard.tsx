"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcgDivider } from "@/components/brand/ecg-line";
import { LockedExamRow } from "@/components/test/locked-exam-row";

type WizardSubject = {
  id: string;
  name: string;
  /** Published OSCE stations in this subject (0 hides it in OSCE mode). */
  osceQuestionCount: number;
};
type WizardSpecialty = { id: string; name: string; subjects: WizardSubject[] };
export type WizardExam = {
  id: string;
  name: string;
  specialties: WizardSpecialty[];
  subjectCount: number;
  questionCount: number;
  /** Not covered by this student's subscription — shown, never hidden. */
  locked: boolean;
  /** OSCE is paid-only; presentation of the /api/tests gate. */
  osceLocked: boolean;
  osceQuestionCount: number;
};

const COUNTS = [10, 20, 40, 60];
/** Free-text stations take minutes each — smaller sessions than MCQ. */
const OSCE_COUNTS = [5, 10, 20];
const DIFFICULTIES = [
  { value: "mixed", label: "Mixed" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

const MODES = [
  {
    value: "tutor",
    label: "Tutor mode",
    description:
      "Untimed practice — check each answer as you go, with full explanations. Pause and pick up again any time.",
  },
  {
    value: "exam",
    label: "Exam mode",
    description:
      "Simulate the real thing — timed, no feedback until you submit, scored at the end.",
  },
  {
    value: "osce",
    label: "OSCE stations",
    description:
      "Type your answer to open questions — graded instantly against a model answer. Untimed, paid plans only.",
  },
] as const;

type Mode = (typeof MODES)[number]["value"];

export function NewTestWizard({
  exams,
  upsellPlanId,
}: {
  exams: WizardExam[];
  /** Plan to send locked-exam upsells to; null when nothing is purchasable. */
  upsellPlanId: string | null;
}) {
  const router = useRouter();

  const unlocked = useMemo(() => exams.filter((e) => !e.locked), [exams]);

  // Mode comes first — it frames every choice after it ("practice or
  // simulate?"). With a single exam in the catalogue the Exam step disappears
  // entirely. It stays visible whenever there is more than one, even if only
  // one is unlocked, because the locked ones are the upsell.
  const steps = useMemo(
    () =>
      exams.length > 1
        ? (["Mode", "Exam", "Subjects", "Format"] as const)
        : (["Mode", "Subjects", "Format"] as const),
    [exams.length]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [examId, setExamId] = useState<string | null>(
    unlocked.length === 1 ? unlocked[0].id : null
  );
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
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

  const osceMode = mode === "osce";

  /** An unlocked exam can still be a dead end for OSCE mode: paid-only, or
   * simply no stations published yet. */
  function examBlockedForOsce(exam: WizardExam) {
    return exam.osceLocked || exam.osceQuestionCount === 0;
  }

  /** Subjects of the chosen exam, grouped by specialty for the headings.
   * OSCE mode only offers subjects that actually have stations. */
  const specialtyGroups = useMemo(
    () =>
      (selectedExam?.specialties ?? [])
        .map((sp) => ({
          ...sp,
          subjects: osceMode
            ? sp.subjects.filter((s) => s.osceQuestionCount > 0)
            : sp.subjects,
        }))
        .filter((sp) => sp.subjects.length > 0),
    [selectedExam, osceMode]
  );
  const examSubjects = useMemo(
    () => specialtyGroups.flatMap((sp) => sp.subjects),
    [specialtyGroups]
  );
  const allSubjectsSelected =
    examSubjects.length > 0 && examSubjects.every((s) => subjectIds.includes(s.id));

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function chooseMode(next: Mode) {
    setMode(next);

    // Each mode offers its own session sizes (OSCE stations take minutes
    // each). Carrying a count across leaves the Format step with no chip
    // highlighted — in BOTH directions, which is why this runs before the
    // early return below.
    const counts: readonly number[] = next === "osce" ? OSCE_COUNTS : COUNTS;
    if (!counts.includes(numQuestions)) {
      const fallback = next === "osce" ? 10 : 20;
      setNumQuestions(fallback);
      setDurationMin(Math.max(5, Math.round(fallback * 1.5)));
    }

    if (next !== "osce") return;
    // Prior selections may be invalid in OSCE mode (paid-only exam, subjects
    // without stations).
    if (selectedExam && examBlockedForOsce(selectedExam)) {
      setExamId(null);
      setSubjectIds([]);
      return;
    }
    const withStations = new Set(
      (selectedExam?.specialties ?? [])
        .flatMap((sp) => sp.subjects)
        .filter((s) => s.osceQuestionCount > 0)
        .map((s) => s.id)
    );
    setSubjectIds((prev) => prev.filter((id) => withStations.has(id)));
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
          difficulty,
          numQuestions,
          mode,
          // Tutor sessions are untimed — no duration is sent at all.
          ...(mode === "exam" ? { durationMin } : {}),
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

  function selectExam(exam: WizardExam) {
    if (exam.locked || examId === exam.id) return;
    setExamId(exam.id);
    // Selections belong to the previous exam's tree.
    setSubjectIds([]);
  }

  const examReady =
    selectedExam !== null &&
    !selectedExam.locked &&
    (!osceMode || !examBlockedForOsce(selectedExam));

  const canAdvance =
    currentStep === "Mode"
      ? mode !== null
      : currentStep === "Exam"
        ? examReady
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
          {currentStep === "Mode" && (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-display text-lg">
                Practice with explanations, or simulate the exam?
              </legend>
              <div className="grid gap-2.5">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={mode === m.value}
                    onClick={() => chooseMode(m.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
                      "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                      mode === m.value
                        ? "border-primary bg-accent"
                        : "border-border hover:border-primary/50 hover:bg-accent/50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        mode === m.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      )}
                      aria-hidden="true"
                    >
                      {mode === m.value && (
                        <Check className="size-3" strokeWidth={3} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{m.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {currentStep === "Exam" && (
            <fieldset className="space-y-3">
              <legend className="mb-3 font-display text-lg">
                Which examination are you preparing for?
              </legend>
              {/* Cards rather than the Chip pills the other steps use: an
                  exam now carries counts, a lock state and a CTA, none of
                  which fit on a pill. */}
              <div className="grid gap-2.5">
                {exams.map((e) =>
                  e.locked || (osceMode && e.osceLocked) ? (
                    <LockedExamRow
                      key={e.id}
                      name={e.name}
                      subjectCount={e.subjectCount}
                      questionCount={e.questionCount}
                      href={
                        upsellPlanId
                          ? `/checkout/${upsellPlanId}?exam=${e.id}`
                          : null
                      }
                    />
                  ) : osceMode && e.osceQuestionCount === 0 ? (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 opacity-60"
                    >
                      <span
                        className="flex size-5 shrink-0 rounded-full border border-input"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium wrap-break-word">
                          {e.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          No OSCE stations yet
                        </span>
                      </span>
                    </div>
                  ) : (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={examId === e.id}
                      onClick={() => selectExam(e)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
                        "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                        examId === e.id
                          ? "border-primary bg-accent"
                          : "border-border hover:border-primary/50 hover:bg-accent/50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          examId === e.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input"
                        )}
                        aria-hidden="true"
                      >
                        {examId === e.id && (
                          <Check className="size-3" strokeWidth={3} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium wrap-break-word">
                          {e.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {osceMode ? (
                            <>
                              {e.osceQuestionCount.toLocaleString()} OSCE station
                              {e.osceQuestionCount === 1 ? "" : "s"}
                            </>
                          ) : (
                            <>
                              {e.subjectCount} subject
                              {e.subjectCount === 1 ? "" : "s"} ·{" "}
                              {e.questionCount.toLocaleString()} question
                              {e.questionCount === 1 ? "" : "s"}
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  )
                )}
              </div>
            </fieldset>
          )}

          {currentStep === "Subjects" && (
            <fieldset className="space-y-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <legend className="font-display text-lg">Which subjects?</legend>
                {examSubjects.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSubjectIds(
                        allSubjectsSelected ? [] : examSubjects.map((s) => s.id)
                      )
                    }
                  >
                    {allSubjectsSelected ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>

              {specialtyGroups.length > 1 ? (
                <div className="space-y-4">
                  {specialtyGroups.map((sp) => (
                    <div key={sp.id}>
                      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {sp.name}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sp.subjects.map((s) => (
                          <Chip
                            key={s.id}
                            label={
                              osceMode
                                ? `${s.name} (${s.osceQuestionCount})`
                                : s.name
                            }
                            selected={subjectIds.includes(s.id)}
                            onClick={() =>
                              setSubjectIds(toggle(subjectIds, s.id))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {examSubjects.map((s) => (
                    <Chip
                      key={s.id}
                      label={
                        osceMode ? `${s.name} (${s.osceQuestionCount})` : s.name
                      }
                      selected={subjectIds.includes(s.id)}
                      onClick={() => setSubjectIds(toggle(subjectIds, s.id))}
                    />
                  ))}
                </div>
              )}

              {examSubjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {osceMode
                    ? "No OSCE stations have been published yet"
                    : "No subjects have been published yet"}
                  {selectedExam ? ` for ${selectedExam.name}` : ""}.
                </p>
              )}
            </fieldset>
          )}

          {currentStep === "Format" && (
            <div className="space-y-6">
              <fieldset>
                <legend className="mb-3 font-display text-lg">
                  {osceMode ? "How many stations?" : "How many questions?"}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(osceMode ? OSCE_COUNTS : COUNTS).map((n) => (
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

              {mode === "exam" && (
                <fieldset>
                  <legend className="mb-3 font-display text-lg">
                    Time limit
                  </legend>
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
              )}

              <EcgDivider className="my-2" />

              <dl className="grid grid-cols-3 gap-3 text-sm">
                <Summary label="Subjects" value={String(subjectIds.length)} />
                <Summary
                  label={osceMode ? "Stations" : "Questions"}
                  value={String(numQuestions)}
                />
                <Summary
                  label="Time"
                  value={mode === "exam" ? `${durationMin} min` : "Untimed"}
                />
              </dl>
            </div>
          )}

          {/* Why the Start button is dead. The Exam step explains this with a
              locked/greyed row, but it does not exist when the catalogue has
              a single exam — without this the wizard would just refuse to
              start and say nothing. */}
          {osceMode && selectedExam && examBlockedForOsce(selectedExam) && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              {selectedExam.osceLocked ? (
                <>
                  OSCE stations are part of the paid plan.{" "}
                  {upsellPlanId && (
                    <Link
                      href={`/checkout/${upsellPlanId}?exam=${selectedExam.id}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Get access
                    </Link>
                  )}
                </>
              ) : (
                <>No OSCE stations have been published for {selectedExam.name} yet.</>
              )}
            </p>
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
                disabled={submitting || !examReady || subjectIds.length === 0}
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    Building your test…
                  </>
                ) : mode === "tutor" ? (
                  "Start practising"
                ) : osceMode ? (
                  "Start stations"
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  languageByCode,
  resolveTranslationLanguage,
} from "@/lib/translation-core";
import { translatedAttrs } from "@/lib/translation-ui-core";
import { LanguageSelect } from "@/components/language-select";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EcgDivider } from "@/components/brand/ecg-line";
import { LockedExamRow } from "@/components/test/locked-exam-row";

type WizardSubject = {
  id: string;
  name: string;
  /** Published MCQs in this subject (0 hides it in exam/tutor mode). */
  questionCount: number;
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
  /** Trial sessions are short (TRIAL_MAX_QUESTIONS); null when unmetered. */
  questionCap: number | null;
};

const COUNTS = [5, 10, 20, 40, 60];
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
  enabledLanguageCodes = [],
  defaultLanguage = null,
}: {
  exams: WizardExam[];
  /** Plan to send locked-exam upsells to; null when nothing is purchasable. */
  upsellPlanId: string | null;
  /** Translation languages the admin has switched on; empty hides the step. */
  enabledLanguageCodes?: string[];
  /** profiles.preferred_language — the select's starting value. */
  defaultLanguage?: string | null;
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
  // A preselected metered exam starts at its cap, not 20 — selectExam never
  // runs for it, so nothing else would clamp the default.
  const [numQuestions, setNumQuestions] = useState(() =>
    unlocked.length === 1 && unlocked[0].questionCap !== null
      ? Math.min(20, unlocked[0].questionCap)
      : 20
  );
  const [difficulty, setDifficulty] =
    useState<(typeof DIFFICULTIES)[number]["value"]>("mixed");
  const [durationMin, setDurationMin] = useState(30);
  // The same resolver the routes use: a since-disabled profile default
  // means none, never a dead option.
  const [language, setLanguage] = useState<string | null>(
    () =>
      resolveTranslationLanguage({
        testLanguage: null,
        requested: undefined,
        profileDefault: defaultLanguage,
        enabled: enabledLanguageCodes,
      }).language
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStep = steps[stepIndex];

  // Only the step content scrolls; header and footer are pinned. Each step
  // starts at the top, and a fade at the bottom edge hints that more chips /
  // exams sit below the fold — without it the clipped list looks complete.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    // Short viewports fall back to document scroll (see tests/new/page.tsx);
    // a no-op otherwise.
    window.scrollTo(0, 0);
    const update = () =>
      setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [stepIndex, mode, examId]);

  function close() {
    // Return to wherever the user came from; a direct link has no in-app
    // history, so fall back to the dashboard rather than leaving the site.
    if (document.referrer.startsWith(window.location.origin)) router.back();
    else router.push("/dashboard");
  }

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

  /** An exam that holds only OSCE stations is a dead end for exam/tutor
   * mode — /api/tests deals MCQs only there and would 422 at the last step.
   * Mirrors examBlockedForOsce so both directions are explained up front. */
  function examBlockedForMcq(exam: WizardExam) {
    return exam.questionCount === 0;
  }

  /** The count that matters for the chosen mode: the candidate filter in
   * /api/tests is type-exclusive both ways, so a subject with only stations
   * is empty to exam/tutor mode and vice versa. */
  // Commented out with the chip labels that used it — bank sizes are hidden
  // from students. Restore together with the `(${subjectCountFor(s)})` labels.
  // function subjectCountFor(subject: WizardSubject) {
  //   return osceMode ? subject.osceQuestionCount : subject.questionCount;
  // }

  /** Subjects of the chosen exam, grouped by specialty for the headings.
   * Each mode only offers subjects that actually have questions of its
   * type — exams may legitimately mix MCQs and stations. */
  const specialtyGroups = useMemo(
    () =>
      (selectedExam?.specialties ?? [])
        .map((sp) => ({
          ...sp,
          subjects: sp.subjects.filter((s) =>
            osceMode ? s.osceQuestionCount > 0 : s.questionCount > 0
          ),
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
    const cap = selectedExam?.questionCap ?? null;
    const counts: readonly number[] = (
      next === "osce" ? OSCE_COUNTS : COUNTS
    ).filter((n) => cap === null || n <= cap);
    if (!counts.includes(numQuestions)) {
      const fallback = Math.min(next === "osce" ? 10 : 20, cap ?? Infinity);
      setNumQuestions(fallback);
      setDurationMin(Math.max(5, Math.round(fallback * 1.5)));
    }

    // Prior selections may be invalid in the new mode: a paid-only or
    // stations-less exam for OSCE, an OSCE-only exam for exam/tutor, and
    // subjects with no questions of the new type either way.
    const osce = next === "osce";
    if (
      selectedExam &&
      (osce ? examBlockedForOsce(selectedExam) : examBlockedForMcq(selectedExam))
    ) {
      setExamId(null);
      setSubjectIds([]);
      return;
    }
    const offered = new Set(
      (selectedExam?.specialties ?? [])
        .flatMap((sp) => sp.subjects)
        .filter((s) => (osce ? s.osceQuestionCount : s.questionCount) > 0)
        .map((s) => s.id)
    );
    setSubjectIds((prev) => prev.filter((id) => offered.has(id)));
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
          // Sent whenever the select was shown: `null` is the explicit
          // "English only", which must beat a profile default server-side.
          ...(enabledLanguageCodes.length > 0 ? { language } : {}),
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
    // A metered exam offers only the trial-sized session; the server clamps
    // anyway, but the Format step should never show a stale larger pick.
    if (exam.questionCap !== null && numQuestions > exam.questionCap) {
      setNumQuestions(exam.questionCap);
      setDurationMin(Math.max(5, Math.round(exam.questionCap * 1.5)));
    }
  }

  // Every size stays visible: the over-cap ones are the upsell (a locked
  // chip opens a Buy-now bubble), the same way locked exams are listed.
  const questionCap = selectedExam?.questionCap ?? null;
  const counts = osceMode ? OSCE_COUNTS : COUNTS;
  const countLocked = (n: number) => questionCap !== null && n > questionCap;
  const checkoutHref =
    upsellPlanId && selectedExam
      ? `/checkout/${upsellPlanId}?exam=${selectedExam.id}`
      : null;

  const examReady =
    selectedExam !== null &&
    !selectedExam.locked &&
    (osceMode
      ? !examBlockedForOsce(selectedExam)
      : !examBlockedForMcq(selectedExam));

  const canAdvance =
    currentStep === "Mode"
      ? mode !== null
      : currentStep === "Exam"
        ? examReady
        : currentStep === "Subjects"
          ? subjectIds.length > 0
          : true;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background sm:rounded-xl sm:border sm:border-border sm:bg-card sm:shadow-xs">
      <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="hidden font-display text-2xl font-semibold tracking-tight sm:block">
              Start a new test
            </h1>
            {/* Narrow screens can't fit four labelled nodes; the dots carry
                progress and this line names where we are. */}
            <p className="text-sm font-medium sm:hidden">
              Step {stepIndex + 1} of {steps.length} · {currentStep}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            disabled={submitting}
            aria-label="Close"
          >
            <X />
          </Button>
        </div>

        <ol className="mt-2 flex items-center gap-2 text-xs sm:mt-3">
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
                  "hidden sm:inline",
                  i === stepIndex ? "font-medium" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
              {i < steps.length - 1 && (
                <span
                  className="hidden h-px w-6 bg-border sm:mx-1 sm:block"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </header>

      {/* Flex sizing rather than h-full: from `sm` the page only caps the
          card with max-height, which is not a definite height for
          percentage children but does constrain a shrinking flex item. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={bodyRef}
          inert={submitting}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
        >
          <div className="space-y-6">
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
                  ) : (osceMode ? e.osceQuestionCount : e.questionCount) === 0 ? (
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
                          {osceMode
                            ? e.questionCount > 0
                              ? "No OSCE stations yet — switch to Tutor or Exam mode for its questions"
                              : "No OSCE stations yet"
                            : e.osceQuestionCount > 0
                              ? "OSCE stations only — switch to OSCE stations mode"
                              : "No questions published yet"}
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
                        {/* Bank sizes are deliberately hidden from students;
                            the OSCE hint stays (without a number) because an
                            exam may mix MCQs and stations and the student
                            needs to know the other mode has content. */}
                        <span className="block text-xs text-muted-foreground">
                          {e.subjectCount} subject
                          {e.subjectCount === 1 ? "" : "s"}
                          {/*
                          {" "}· {e.questionCount.toLocaleString()} question
                          {e.questionCount === 1 ? "" : "s"}
                          */}
                          {e.osceQuestionCount > 0 && (
                            <>
                              {" "}· includes OSCE stations
                              {/* {e.osceQuestionCount.toLocaleString()} OSCE
                              station{e.osceQuestionCount === 1 ? "" : "s"} */}
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
                            // Bank size hidden from students: `${s.name} (${subjectCountFor(s)})`
                            label={s.name}
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
                      // Bank size hidden from students: `${s.name} (${subjectCountFor(s)})`
                      label={s.name}
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
                    : "No questions have been published yet"}
                  {selectedExam ? ` for ${selectedExam.name}` : ""}.
                  {!osceMode && (selectedExam?.osceQuestionCount ?? 0) > 0 &&
                    " Switch to OSCE stations mode to practise its stations."}
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
                  {counts.map((n) =>
                    countLocked(n) ? (
                      <LockedCountChip
                        key={n}
                        label={String(n)}
                        cap={questionCap!}
                        checkoutHref={checkoutHref}
                      />
                    ) : (
                      <Chip
                        key={n}
                        label={String(n)}
                        selected={numQuestions === n}
                        onClick={() => {
                          setNumQuestions(n);
                          setDurationMin(Math.max(5, Math.round(n * 1.5)));
                        }}
                      />
                    )
                  )}
                </div>
                {questionCap !== null && !osceMode && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Trial sessions are {questionCap} questions each. Upgrade
                    for full-length papers.
                  </p>
                )}
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

              {enabledLanguageCodes.length > 0 && (
                <fieldset>
                  <legend className="mb-3 font-display text-lg">
                    Translation language
                  </legend>
                  <LanguageSelect
                    id="wizard-language"
                    enabledLanguageCodes={enabledLanguageCodes}
                    value={language}
                    onChange={setLanguage}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Optional. You get a Translate button on each question; the
                    paper itself stays in English. Fixed once the test starts.
                  </p>
                </fieldset>
              )}

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

              <dl
                className={cn(
                  "grid gap-3 text-sm",
                  enabledLanguageCodes.length > 0
                    ? "grid-cols-2 sm:grid-cols-4"
                    : "grid-cols-3"
                )}
              >
                <Summary label="Subjects" value={String(subjectIds.length)} />
                <Summary
                  label={osceMode ? "Stations" : "Questions"}
                  value={String(numQuestions)}
                />
                <Summary
                  label="Time"
                  value={mode === "exam" ? `${durationMin} min` : "Untimed"}
                />
                {enabledLanguageCodes.length > 0 && (
                  <Summary
                    label="Language"
                    value={
                      language ? (
                        <span {...translatedAttrs(language)}>
                          {languageByCode(language)?.nativeName ?? language}
                        </span>
                      ) : (
                        "English"
                      )
                    }
                  />
                )}
              </dl>
            </div>
          )}

          {/* Why the Start button is dead. The Exam step explains this with a
              locked/greyed row, but it does not exist when the catalogue has
              a single exam — without this the wizard would just refuse to
              start and say nothing. */}
          {!osceMode && selectedExam && examBlockedForMcq(selectedExam) && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              {selectedExam.osceQuestionCount > 0
                ? `${selectedExam.name} only has OSCE stations so far — switch to OSCE stations mode to practise them.`
                : `No questions have been published for ${selectedExam.name} yet.`}
            </p>
          )}
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

          </div>
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-background to-transparent transition-opacity sm:from-card",
            moreBelow ? "opacity-100" : "opacity-0"
          )}
        />
      </div>

      <footer className="shrink-0 space-y-3 border-t border-border px-4 pt-3 pb-[max(--spacing(3),env(safe-area-inset-bottom))] sm:px-6 sm:pt-4 sm:pb-[max(--spacing(4),env(safe-area-inset-bottom))]">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
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

          {currentStep === "Subjects" && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {subjectIds.length} selected
            </p>
          )}

          {stepIndex < steps.length - 1 ? (
            <Button
              className="flex-1 sm:ml-auto sm:flex-none"
              onClick={() => setStepIndex(stepIndex + 1)}
              disabled={!canAdvance}
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button
              className="flex-1 sm:ml-auto sm:flex-none"
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
      </footer>
    </div>
  );
}

/**
 * An over-cap session size for a trial user. Not `disabled` — a disabled
 * button can't be clicked, and the click IS the upsell: it opens a bubble
 * with the Buy-now link. Presentation only; /api/tests clamps regardless.
 */
function LockedCountChip({
  label,
  cap,
  checkoutHref,
}: {
  label: string;
  cap: number;
  checkoutHref: string | null;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} questions — paid plans only`}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border bg-muted/40 px-4 text-sm font-medium text-muted-foreground transition-colors",
          "hover:border-primary/50 hover:text-foreground",
          "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        )}
      >
        <Lock className="size-3.5" aria-hidden="true" />
        {label}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 gap-2 p-3">
        <p className="font-display text-sm font-semibold">
          Full-length sessions are part of the paid plan
        </p>
        <p className="text-xs text-muted-foreground">
          Trial sessions are {cap} questions each. Unlock {label}-question
          papers and the whole bank.
        </p>
        {checkoutHref ? (
          <Button size="sm" asChild>
            <Link href={checkoutHref}>
              Buy now
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link href="/#pricing">View plans</Link>
          </Button>
        )}
      </PopoverContent>
    </Popover>
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
        "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
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

function Summary({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-display text-base sm:text-lg">{value}</dd>
    </div>
  );
}

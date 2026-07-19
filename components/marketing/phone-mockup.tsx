import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const IN_APP_STATS = [
  { value: "1,000", label: "Multiple Choice Questions from past papers and intern recalls" },
  { value: "10", label: "OSCE (Objective Structured Clinical Examination) stations" },
  { value: "2", label: "Question bank updated after exams, twice a year" },
];

/**
 * Marketing device shot: the in-app screen behind, with a sample answered
 * question overlapping the lower-right. Pure CSS/SVG — no image asset to
 * keep in sync.
 */
export function PhoneMockup() {
  return (
    <div className="relative w-full max-w-[22rem]">
      {/* Phone body */}
      <div className="overflow-hidden rounded-[2.25rem] border-[6px] border-ink bg-ink shadow-2xl">
        <div className="relative overflow-hidden rounded-[1.85rem] bg-card">
          {/* Notch */}
          <div className="absolute top-2 left-1/2 z-10 h-5 w-28 -translate-x-1/2 rounded-full bg-ink" />

          {/* Branded app header */}
          <div className="bg-brand-surface px-5 pt-10 pb-8 text-white">
            <div className="flex items-center justify-between text-[0.7rem]">
              <span aria-hidden="true">☰</span>
              <Logo href={null} size="sm" onDark />
            </div>

            <h3 className="mt-6 font-display text-xl leading-snug font-semibold">
              Pass your Medical Board and Exit Examinations Today!
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-white/85">
              Taking your exam preparation to the next level through practice
              questions.
            </p>

            <span className="mt-4 inline-flex rounded-full bg-sun px-4 py-2 text-[0.7rem] font-semibold text-ink">
              START A TRIAL TEST
            </span>
          </div>

          {/* In-app stats */}
          <div className="space-y-4 px-5 py-6">
            {IN_APP_STATS.map((stat) => (
              <div key={stat.value}>
                <p className="font-display text-2xl font-bold text-primary">
                  {stat.value}
                </p>
                <p className="text-[0.65rem] leading-snug text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* A real answered question, overlapping the device — shows the actual
          product surface rather than a mocked-up conversation. */}
      <div className="absolute -right-4 -bottom-6 w-56 overflow-hidden rounded-2xl bg-card p-3 shadow-xl ring-1 ring-foreground/10 sm:-right-10">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.55rem] font-medium text-secondary-foreground">
            Medicine
          </span>
          <span className="text-[0.55rem] text-muted-foreground">
            Cardiology
          </span>
        </div>

        <p className="mt-2 text-[0.62rem] leading-snug font-medium">
          ST-segment elevation in leads II, III and aVF. Which artery is most
          likely occluded?
        </p>

        <div className="mt-2 space-y-1.5">
          <Option correct>Right coronary artery</Option>
          <Option>Left circumflex artery</Option>
        </div>

        <div className="mt-2 rounded-lg border-l-2 border-primary bg-secondary/60 px-2 py-1.5">
          <p className="text-[0.5rem] font-semibold tracking-wide text-primary uppercase">
            Explanation
          </p>
          <p className="text-[0.55rem] leading-snug text-foreground/80">
            The inferior leads localise to the right coronary artery.
          </p>
        </div>
      </div>
    </div>
  );
}

function Option({
  children,
  correct = false,
}: {
  children: React.ReactNode;
  correct?: boolean;
}) {
  return (
    <p
      className={
        correct
          ? "flex items-center gap-1.5 rounded-md border border-success bg-success/10 px-2 py-1 text-[0.55rem]"
          : "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[0.55rem] text-muted-foreground"
      }
    >
      {correct && (
        <Check
          className="size-2.5 shrink-0 text-success"
          strokeWidth={3}
          aria-hidden="true"
        />
      )}
      {children}
    </p>
  );
}

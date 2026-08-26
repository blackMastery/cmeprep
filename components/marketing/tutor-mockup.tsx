import { FileText, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * Marketing shot of the AI tutor: one asked-and-answered turn with the
 * citation chips the real chat renders (components/tutor/citation-list.tsx).
 * Pure CSS — no screenshot to keep in sync with the app's tokens. The
 * sources are illustrative file names, not real titles: the real corpus is
 * licensed material and its file names must not be advertised.
 */
const CITATIONS = [
  { n: 1, file: "Cardiovascular system.pdf", page: 42 },
  { n: 2, file: "Clinical examination.pdf", page: 118 },
];

export function TutorMockup() {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-accent text-primary">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </span>
        <p className="font-display text-sm font-semibold">AI tutor</p>
        <p className="ml-auto text-xs text-muted-foreground">
          Answers from the course materials
        </p>
      </div>

      <div className="space-y-4 px-4 py-5">
        {/* Student turn */}
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
          Why does a holosystolic murmur at the apex radiate to the axilla?
        </p>

        {/* Tutor turn */}
        <div className="max-w-[92%] space-y-2 text-sm leading-relaxed">
          <p>
            That pattern is <strong>mitral regurgitation</strong>. The
            regurgitant jet runs from the left ventricle back into the left
            atrium, which sits posteriorly and to the left — so the sound
            carries towards the axilla.{" "}
            <span className="font-medium text-muted-foreground">[1]</span>
          </p>
          <p>
            In a chronic case, also look for a soft S1 and a displaced apex
            beat.{" "}
            <span className="font-medium text-muted-foreground">[2]</span>
          </p>

          <ul className="flex flex-wrap gap-1.5 pt-1">
            {CITATIONS.map((c) => (
              <li
                key={c.n}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <FileText className="size-3 shrink-0" aria-hidden="true" />
                <span className="font-medium tabular-nums text-foreground">
                  [{c.n}]
                </span>
                <span>{c.file}</span>
                <span className="tabular-nums">p.{c.page}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1 pt-1 text-muted-foreground">
            <span className="text-xs">Was this helpful?</span>
            <span className="flex size-6 items-center justify-center rounded-md">
              <ThumbsUp className="size-3.5" aria-hidden="true" />
            </span>
            <span className="flex size-6 items-center justify-center rounded-md">
              <ThumbsDown className="size-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
          <span className="flex-1 text-sm text-muted-foreground">
            Ask a follow-up…
          </span>
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

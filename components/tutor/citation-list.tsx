import Image from "next/image";
import { FileText, Image as ImageIcon, Table2 } from "lucide-react";
import type { Citation } from "@/lib/tutor-core";

/** Must match the remotePatterns entry in next.config.ts. */
const STUDY_IMAGES_PATH = "/storage/v1/object/public/study-images/";

const KIND_ICON = {
  text: FileText,
  figure: ImageIcon,
  table: Table2,
} as const;

/**
 * Sources for one answer.
 *
 * Deliberately not links. The tutor cites files by their Google Drive URL,
 * which no student can open and which points straight at licensed third-party
 * material — the proxy strips it before the stream leaves the server. What is
 * kept is the attribution a student actually needs to look something up in
 * their own copy: which book, which page.
 */
export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  // next/image THROWS during render on a host that next.config.ts does not
  // allow-list, and this renders inside the client chat — so one unexpected
  // URL (staging data ingested against another project, a bucket rename)
  // would take down the whole transcript, not just a thumbnail. Only render
  // what the config is known to permit; the description of every figure is
  // already in the answer text, so dropping the image loses nothing critical.
  const figures = citations.filter((c) =>
    c.image_url?.includes(STUDY_IMAGES_PATH)
  );

  return (
    <div className="mt-3 space-y-3">
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((c) => {
          const Icon = KIND_ICON[c.kind] ?? FileText;
          return (
            <li
              key={c.n}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
            >
              <Icon className="size-3 shrink-0" aria-hidden="true" />
              <span className="font-medium tabular-nums text-foreground">
                [{c.n}]
              </span>
              <span>{c.file_name}</span>
              {c.page !== null && <span className="tabular-nums">p.{c.page}</span>}
            </li>
          );
        })}
      </ul>

      {figures.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {figures.map((c) => (
            <li key={`fig-${c.n}`} className="overflow-hidden rounded-lg border border-border">
              <Image
                src={c.image_url!}
                alt={`Figure from ${c.file_name}${c.page !== null ? `, page ${c.page}` : ""}`}
                width={640}
                height={480}
                // Intrinsic dimensions aren't known here (file_assets has them,
                // citations don't carry them) — let the width drive and keep
                // the aspect ratio rather than cropping a diagram.
                className="h-auto w-full bg-white"
                unoptimized={false}
              />
              <p className="border-t border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">[{c.n}]</span>{" "}
                {c.file_name}
                {c.page !== null && ` · p.${c.page}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

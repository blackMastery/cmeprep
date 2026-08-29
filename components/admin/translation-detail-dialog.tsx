"use client";

import type { TranslationListRow } from "@/lib/admin/translations";
import { languageByCode } from "@/lib/translation-core";
import { translatedAttrs } from "@/lib/translation-ui-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const LETTERS = "ABCDEFGH".split("");

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Side-by-side original vs translation for one cache row. */
export function TranslationDetailDialog({ row }: { row: TranslationListRow }) {
  const language = languageByCode(row.language);
  const tAttrs = translatedAttrs(row.language);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {language?.name ?? row.language} translation
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span>Updated {dateTimeFmt.format(new Date(row.updatedAt))}</span>
            <span>· {row.model}</span>
            {row.stale && (
              <Badge className="border-sun bg-sun/15 text-foreground">
                Stale — English edited since
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Column heading="English">
            <Field label="Stem">{row.original.stem}</Field>
            {row.original.options.length > 0 && (
              <Field label="Options">
                <ol className="space-y-1">
                  {row.original.options.map((o, i) => (
                    <li key={o.id} className="flex gap-2">
                      <span className="w-4 shrink-0 font-medium">
                        {LETTERS[i] ?? i + 1}
                      </span>
                      <span>{o.label}</span>
                    </li>
                  ))}
                </ol>
              </Field>
            )}
            <Field label="Explanation">{row.original.explanation}</Field>
            {row.original.modelAnswer && (
              <Field label="Model answer">{row.original.modelAnswer}</Field>
            )}
          </Column>

          <Column heading={language?.nativeName ?? row.language} headingAttrs={tAttrs}>
            <Field label="Stem">
              <span {...tAttrs}>
                {row.translation.stem}
              </span>
            </Field>
            {row.original.options.length > 0 && (
              <Field label="Options">
                <ol className="space-y-1">
                  {row.original.options.map((o, i) => {
                    const label = row.translation.options[o.id];
                    return (
                      <li key={o.id} className="flex gap-2">
                        <span className="w-4 shrink-0 font-medium">
                          {LETTERS[i] ?? i + 1}
                        </span>
                        {label ? (
                          <span {...tAttrs}>
                            {label}
                          </span>
                        ) : (
                          <span className="text-destructive">— (not translated)</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </Field>
            )}
            <Field label="Explanation">
              <span {...tAttrs}>
                {row.translation.explanation}
              </span>
            </Field>
            {row.original.modelAnswer && (
              <Field label="Model answer">
                {row.translation.modelAnswer ? (
                  <span {...tAttrs}>
                    {row.translation.modelAnswer}
                  </span>
                ) : (
                  <span className="text-destructive">— (not translated)</span>
                )}
              </Field>
            )}
          </Column>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Column({
  heading,
  headingAttrs,
  children,
}: {
  heading: string;
  headingAttrs?: { lang?: string; dir?: "ltr" | "rtl" };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p
        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        {...headingAttrs}
      >
        {heading}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

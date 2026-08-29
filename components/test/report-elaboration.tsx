"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { REPORT_NOTE_MAX,
  reportCategoriesFor,
} from "@/lib/question-reports-core";
import type { QuestionReportCategory } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CategoryPicker, postReport } from "@/components/report-question";

export type ElaborationItem = {
  questionId: string;
  position: number;
  stem: string;
};

/**
 * Results page: the questions tapped "Report a problem" during this test,
 * each with a category picker and optional note. Skipping costs nothing —
 * the bare reports are already filed, and a question carrying 30 bare
 * flags is still obviously broken. So: one compact block, no gate on the
 * rest of the page.
 */
export function ReportElaboration({
  testId,
  items,
}: {
  testId: string;
  items: ElaborationItem[];
}) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  if (items.length === 0) return null;
  const remaining = items.filter((i) => !done.has(i.questionId));

  return (
    <Card className="mt-6 [--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-display text-lg">
            You reported {items.length} question{items.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {remaining.length === 0
              ? "Thanks — that's everything we need."
              : "Already filed. A word on what was wrong helps us fix it faster — optional."}
          </p>
        </div>
        {remaining.length > 0 && (
          <ul className="space-y-4">
            {items.map((item) =>
              done.has(item.questionId) ? (
                <li
                  key={item.questionId}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Check className="size-4 text-success" strokeWidth={3} />
                  Q{item.position + 1} — noted
                </li>
              ) : (
                <ElaborationRow
                  key={item.questionId}
                  testId={testId}
                  item={item}
                  onDone={() =>
                    setDone((prev) => new Set(prev).add(item.questionId))
                  }
                />
              )
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ElaborationRow({
  testId,
  item,
  onDone,
}: {
  testId: string;
  item: ElaborationItem;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<QuestionReportCategory | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const excerpt =
    item.stem.length > 110 ? `${item.stem.slice(0, 110)}…` : item.stem;

  async function save() {
    if (!category) return;
    setSaving(true);
    const { ok, error } = await postReport({
      questionId: item.questionId,
      testId,
      category,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (ok) onDone();
    else toast.error(error ?? "Could not save that. Your report is still filed.");
  }

  return (
    <li className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <p className="text-sm">
        <span className="mr-2 font-medium tabular-nums text-muted-foreground">
          Q{item.position + 1}
        </span>
        {excerpt}
      </p>
      {/* No translation is on screen here, so "Translation is wrong" is not
          offered — the mid-test tap already recorded the language, and the
          report keeps it. */}
      <CategoryPicker
        name={`elab-${item.questionId}`}
        value={category}
        onChange={setCategory}
        categories={reportCategoriesFor({ translationShown: false })}
      />
      {category !== null && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={REPORT_NOTE_MAX}
            rows={2}
            placeholder="Anything else? (optional)"
            aria-label={`Note for question ${item.position + 1}`}
            className="flex-1"
          />
          <Button size="sm" onClick={() => void save()} disabled={saving || !category}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </li>
  );
}

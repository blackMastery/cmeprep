"use client";

import { useState } from "react";
import { questionImageUrl } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { AnswerOption } from "@/components/test/answer-option";
import { QuestionImage } from "@/components/test/question-image";

const LETTERS = "ABCDEFGH".split("");

/**
 * Live student-view preview.
 *
 * Renders from local editor state only — it must never read
 * `question_options_public`, which by definition cannot see an unpublished
 * question. Reuses the real AnswerOption so what the admin sees is what the
 * student gets.
 */
export function QuestionPreview({
  stem,
  imagePath,
  options,
  multi,
}: {
  stem: string;
  imagePath: string | null;
  options: { label: string; isCorrect: boolean }[];
  multi: boolean;
}) {
  const [showKey, setShowKey] = useState(false);
  const imageUrl = questionImageUrl(imagePath);

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-medium text-muted-foreground">
            Student preview
          </h2>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showKey}
              onChange={(e) => setShowKey(e.target.checked)}
              className="size-3.5 accent-[var(--success)]"
            />
            Show key
          </label>
        </div>

        <div className="rounded-lg bg-background p-3">
          <p className="font-display text-sm leading-relaxed">
            {stem.trim() || (
              <span className="text-muted-foreground">
                The stem will appear here…
              </span>
            )}
          </p>

          {imageUrl && (
            <div className="mt-3">
              <QuestionImage src={imageUrl} alt="" maxHeight={160} />
            </div>
          )}

          {multi && (
            <p className="mt-2 text-xs font-medium text-primary">
              Select all that apply.
            </p>
          )}

          <div className="mt-3 space-y-2">
            {options.map((opt, i) => (
              <AnswerOption
                key={i}
                id={`preview-${i}`}
                groupName="preview"
                label={opt.label || `Option ${LETTERS[i] ?? i + 1}`}
                letter={LETTERS[i] ?? String(i + 1)}
                multi={multi}
                selected={false}
                state={showKey && opt.isCorrect ? "missed" : "idle"}
                disabled
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

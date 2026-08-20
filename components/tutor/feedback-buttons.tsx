"use client";

import { useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TutorRating } from "@/lib/supabase/types";

const COPY = {
  up: {
    title: "Give positive feedback",
    placeholder: "What was satisfying about this response?",
    label: "Rate this answer as good",
  },
  down: {
    title: "Give negative feedback",
    placeholder: "What was unsatisfying about this response?",
    label: "Rate this answer as bad",
  },
} as const;

/**
 * Thumbs up / down on one tutor answer, with an optional detail dialog.
 *
 * The rating is saved on CLICK, before the dialog is answered — it is the
 * signal actually worth having, and requiring an explanation first is how you
 * end up with no ratings at all. Cancel therefore keeps the rating and only
 * dismisses the note; Submit adds the detail to the same row.
 *
 * For a strict-RAG tutor this is the primary quality instrument: a thumbs-down
 * separates "the corpus doesn't cover this" from "retrieval pulled the wrong
 * passages", and a thumbs-up is the only evidence that the retrieval tuning is
 * working on real questions rather than on the eval set.
 */
export function FeedbackButtons({ messageId }: { messageId: string }) {
  const noteId = useId();
  const disclaimerId = useId();
  const [rating, setRating] = useState<TutorRating | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function send(next: TutorRating, detail?: string) {
    const res = await fetch("/api/tutor/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        rating: next,
        ...(detail === undefined ? {} : { note: detail }),
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  async function rate(next: TutorRating) {
    const previous = rating;
    setRating(next); // optimistic: the dialog opens on an already-set rating
    setNote("");
    setOpen(true);
    try {
      await send(next);
    } catch {
      setRating(previous);
      setOpen(false);
      toast.error("Couldn't save that rating. Try again.");
    }
  }

  async function submitNote() {
    if (!rating) return;
    setSaving(true);
    try {
      await send(rating, note.trim());
      setOpen(false);
      toast.success("Thanks — this helps us improve the tutor.");
    } catch {
      toast.error("Couldn't send that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const copy = rating ? COPY[rating] : COPY.up;

  return (
    <>
      <div className="mt-2 flex items-center gap-1">
        {(["up", "down"] as const).map((value) => {
          const Icon = value === "up" ? ThumbsUp : ThumbsDown;
          const active = rating === value;
          return (
            <Button
              key={value}
              variant="ghost"
              size="icon-xs"
              aria-label={COPY[value].label}
              aria-pressed={active}
              onClick={() => rate(value)}
              className={cn(
                "text-muted-foreground",
                active && "text-primary bg-accent"
              )}
            >
              <Icon aria-hidden="true" />
            </Button>
          );
        })}
        {rating && (
          <span className="ml-1 text-xs text-muted-foreground">
            Thanks for the feedback
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" aria-describedby={disclaimerId}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={noteId}>Please provide details: (optional)</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={copy.placeholder}
              rows={4}
              maxLength={1000}
              autoFocus
              className="resize-none"
            />
          </div>

          <p id={disclaimerId} className="text-xs text-muted-foreground italic">
            Your question, the tutor&apos;s answer and the sources it used are
            shared with the CME Prep team to improve the tutor.
          </p>

          <DialogFooter>
            <Button
              variant="outline-muted"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submitNote} disabled={saving}>
              {saving ? "Sending…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

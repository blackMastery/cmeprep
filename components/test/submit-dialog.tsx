"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function SubmitDialog({
  unanswered,
  total,
  submitting,
  onConfirm,
  fullWidth = false,
}: {
  unanswered: number;
  total: number;
  submitting: boolean;
  onConfirm: () => void;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="lg"
          className={cn(fullWidth ? "w-full" : "ml-auto")}
          disabled={submitting}
        >
          Submit test
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Submit your test?
          </DialogTitle>
          <DialogDescription>
            You won&apos;t be able to change your answers after this.
          </DialogDescription>
        </DialogHeader>

        {unanswered > 0 && (
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">
                {unanswered} of {total}
              </strong>{" "}
              {unanswered === 1 ? "question is" : "questions are"} still
              unanswered. Unanswered questions are marked incorrect.
            </span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline-muted">Keep working</Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

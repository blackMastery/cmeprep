"use client";

import { useState } from "react";
import { ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * "Report this answer" — the quality signal for a strict-RAG tutor.
 *
 * A report almost always means retrieval missed or the corpus has a gap, both
 * of which are fixable. Reporting is one-way and idempotent: there is no
 * regeneration and the answer stands, exactly as with OSCE grade reports.
 */
export function ReportButton({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function report() {
    setState("sending");
    try {
      const res = await fetch("/api/tutor/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      toast.success("Thanks — we'll review this answer.");
    } catch {
      setState("idle");
      toast.error("Couldn't send that report. Try again.");
    }
  }

  if (state === "sent") {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Reported for review.</p>
    );
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      className="mt-2 text-muted-foreground"
      onClick={report}
      disabled={state === "sending"}
    >
      <ThumbsDown data-icon="inline-start" aria-hidden="true" />
      Report this answer
    </Button>
  );
}

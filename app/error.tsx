"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page failed to load. Your test progress is saved on our servers —
          nothing is lost.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

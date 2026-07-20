"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { toggleBookmark } from "@/app/(app)/bookmarks/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Optimistic bookmark toggle; reverts with a toast if the write fails. */
export function BookmarkToggle({
  questionId,
  initialBookmarked,
}: {
  questionId: string;
  initialBookmarked: boolean;
}) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [, startTransition] = useTransition();

  const toggle = () => {
    const next = !bookmarked;
    setBookmarked(next);
    startTransition(async () => {
      const { ok } = await toggleBookmark(questionId, next);
      if (!ok) {
        setBookmarked(!next);
        toast.error("Could not update bookmark");
      }
    });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this question"}
      className={cn(bookmarked && "text-primary hover:text-primary")}
    >
      {bookmarked ? (
        <BookmarkCheck className="size-4" fill="currentColor" />
      ) : (
        <Bookmark className="size-4" />
      )}
    </Button>
  );
}

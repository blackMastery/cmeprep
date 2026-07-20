import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { BOOKMARKS_PAGE_SIZE, getBookmarksPage } from "@/lib/bookmarks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookmarkCard } from "@/components/bookmarks/bookmark-card";
import { Pager } from "@/components/pager";

export const metadata: Metadata = { title: "Bookmarks" };

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function BookmarksPage(props: PageProps<"/bookmarks">) {
  const sp = await props.searchParams;
  const user = await requireUser();

  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const result = await getBookmarksPage(user.id, page);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Bookmarks
        </h1>
        <p className="mt-1 text-muted-foreground">
          {result.total} saved question{result.total === 1 ? "" : "s"}.
        </p>
      </header>

      {result.rows.length > 0 ? (
        <>
          <ul className="space-y-4">
            {result.rows.map((row) => (
              <li key={row.questionId}>
                <BookmarkCard row={row} />
              </li>
            ))}
          </ul>
          <Pager
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            shown={result.rows.length}
            pageSize={BOOKMARKS_PAGE_SIZE}
            basePath="/bookmarks"
            params={sp}
          />
        </>
      ) : (
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
              <Bookmark className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg">No bookmarks yet</h2>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Tap the bookmark icon while reviewing a test to save questions
                here for later.
              </p>
            </div>
            <Button asChild>
              <Link href="/tests">Review a past test</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

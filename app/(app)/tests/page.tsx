import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Test } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryTable } from "@/components/history/history-table";
import { Pager } from "@/components/pager";

export const metadata: Metadata = { title: "Test history" };

const HISTORY_PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function TestHistoryPage(props: PageProps<"/tests">) {
  const sp = await props.searchParams;
  const user = await requireUser();

  const rawStatus = one(sp.status);
  const status: StatusFilter = STATUS_FILTERS.some(
    (f) => f.value === rawStatus
  )
    ? (rawStatus as StatusFilter)
    : "all";
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const from = (page - 1) * HISTORY_PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from("tests")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (status !== "all") query = query.eq("status", status);

  const { data, count } = await query;
  const tests = (data ?? []) as Test[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Test history
          </h1>
          <p className="mt-1 text-muted-foreground">
            {total} test{total === 1 ? "" : "s"}
            {status !== "all" ? " matching" : ""}.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link href="/tests/new">
            <Plus data-icon="inline-start" />
            New test
          </Link>
        </Button>
      </header>

      <div className="mb-6 flex flex-wrap gap-2" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => {
          const active = f.value === status;
          return (
            <Button
              key={f.value}
              variant={active ? "default" : "outline-muted"}
              size="sm"
              asChild
            >
              <Link
                href={
                  f.value === "all" ? "/tests" : `/tests?status=${f.value}`
                }
                aria-current={active ? "page" : undefined}
              >
                {f.label}
              </Link>
            </Button>
          );
        })}
      </div>

      {tests.length > 0 ? (
        <>
          <HistoryTable tests={tests} />
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            shown={tests.length}
            pageSize={HISTORY_PAGE_SIZE}
            basePath="/tests"
            params={sp}
          />
        </>
      ) : (
        <EmptyState filtered={status !== "all"} />
      )}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
          <ClipboardList className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-lg">
            {filtered ? "Nothing here" : "No tests yet"}
          </h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {filtered
              ? "No tests match this filter."
              : "Your first mock exam is a few clicks away. Pick a subject and we'll build it for you."}
          </p>
        </div>
        {!filtered && (
          <Button asChild>
            <Link href="/tests/new">Start your first test</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

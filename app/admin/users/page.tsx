import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  listUsers,
  USER_SORTS,
  USERS_PAGE_SIZE,
  type UserSortKey,
} from "@/lib/admin/users";
import { ROLE_LABEL } from "@/lib/format";
import { USER_ROLES } from "@/lib/validation";
import type { UserRole } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/pager";
import { UsersTable } from "@/components/admin/users-table";

export const metadata: Metadata = { title: "Users" };

const SELECT_CLASS =
  "h-9 max-w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export default async function AdminUsersPage(props: PageProps<"/admin/users">) {
  const sp = await props.searchParams;

  const rawRole = one(sp.role);
  const role = USER_ROLES.includes(rawRole as UserRole)
    ? (rawRole as UserRole)
    : undefined;

  const sort: UserSortKey = USER_SORTS.includes(one(sp.sort) as UserSortKey)
    ? (one(sp.sort) as UserSortKey)
    : "joined";
  const desc =
    sort === "joined" ? one(sp.dir) !== "asc" : one(sp.dir) === "desc";

  const result = await listUsers({
    search: one(sp.q),
    role,
    page: Number(one(sp.page) ?? 1) || 1,
    sort,
    dir: desc ? "desc" : "asc",
  });

  /** Rebuild the query string with one key changed, dropping defaults. */
  const href = (over: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: one(sp.q),
      role,
      sort: sort === "joined" ? undefined : sort,
      dir:
        sort === "joined"
          ? desc
            ? undefined
            : "asc"
          : desc
            ? "desc"
            : undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") params.set(k, v);
    }
    const qs = params.toString();
    return qs === "" ? "/admin/users" : `/admin/users?${qs}`;
  };

  /** Header link: click to sort; click again to flip direction. */
  const sortHref = (key: UserSortKey) => {
    const resetPage = { page: undefined as string | undefined };
    if (sort === key) {
      if (sort === "joined") {
        return href({ ...resetPage, sort: key, dir: desc ? "asc" : undefined });
      }
      return href({ ...resetPage, sort: key, dir: desc ? undefined : "desc" });
    }
    return href({ ...resetPage, sort: key, dir: undefined });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Users
        </h1>
        <p className="mt-1 text-muted-foreground">
          {result.total} account{result.total === 1 ? "" : "s"}
          {one(sp.q) || role ? " matching" : ""}.
        </p>
      </header>

      <form
        method="get"
        action="/admin/users"
        className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            type="search"
            defaultValue={one(sp.q) ?? ""}
            placeholder="Search names and emails…"
            aria-label="Search users"
            className="h-9 pl-8"
          />
        </div>

        <select
          name="role"
          defaultValue={role ?? ""}
          aria-label="Role"
          className={SELECT_CLASS}
        >
          <option value="">All roles</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>

        {sort !== "joined" && <input type="hidden" name="sort" value={sort} />}
        {sort === "joined"
          ? !desc && <input type="hidden" name="dir" value="asc" />
          : desc && <input type="hidden" name="dir" value="desc" />}

        <Button type="submit" size="sm">
          Filter
        </Button>
        <Button variant="ghost" size="sm" type="button" asChild>
          <Link href="/admin/users">Reset</Link>
        </Button>
      </form>

      <UsersTable rows={result.rows} sort={sort} desc={desc} sortHref={sortHref} />

      {result.total > 0 && (
        <Pager
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          shown={result.rows.length}
          pageSize={USERS_PAGE_SIZE}
          basePath="/admin/users"
          params={sp}
        />
      )}
    </div>
  );
}

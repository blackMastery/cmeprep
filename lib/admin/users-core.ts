import type { UserRole } from "@/lib/supabase/types";

export const USER_SORTS = [
  "name",
  "email",
  "role",
  "plan",
  "questions",
  "tests",
  "joined",
] as const;
export type UserSortKey = (typeof USER_SORTS)[number];

export const PROFILE_SORTS = ["name", "role", "joined"] as const;
export type ProfileSortKey = (typeof PROFILE_SORTS)[number];

export function isProfileSort(sort: UserSortKey): sort is ProfileSortKey {
  return (PROFILE_SORTS as readonly string[]).includes(sort);
}

export function profileOrderColumn(sort: ProfileSortKey): string {
  switch (sort) {
    case "name":
      return "full_name";
    case "role":
      return "role";
    case "joined":
      return "created_at";
  }
}

/** Minimal row for sorting the admin user list across joined tables. */
export type UserSortRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  /** Latest subscription period end; null when none. */
  planEnd: string | null;
  questions: number;
  tests: number;
  joined: string;
};

/** Nulls and empties always trail, matching lib/orgs readiness sorting. */
function cmpString(a: string | null, b: string | null): number {
  const aEmpty = !a || a.trim() === "";
  const bEmpty = !b || b.trim() === "";
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty);
  return a.localeCompare(b);
}

export function compareUserSortRows(
  a: UserSortRow,
  b: UserSortRow,
  sort: UserSortKey
): number {
  switch (sort) {
    case "name":
      return cmpString(a.name, b.name);
    case "email":
      return cmpString(a.email, b.email);
    case "role":
      return a.role.localeCompare(b.role);
    case "plan":
      if (!a.planEnd || !b.planEnd) {
        return Number(!a.planEnd) - Number(!b.planEnd);
      }
      return a.planEnd.localeCompare(b.planEnd);
    case "questions":
      return a.questions - b.questions;
    case "tests":
      return a.tests - b.tests;
    case "joined":
      return a.joined.localeCompare(b.joined);
  }
}

export function sortUserSortRows(
  rows: UserSortRow[],
  sort: UserSortKey,
  ascending: boolean
): UserSortRow[] {
  const sorted = [...rows].sort((a, b) => compareUserSortRows(a, b, sort));
  if (ascending) return sorted;
  // Keep nulls trailing when reversing string/plan columns.
  if (sort === "name" || sort === "email" || sort === "plan") {
    const hasValue = (r: UserSortRow) => {
      if (sort === "name") return Boolean(r.name?.trim());
      if (sort === "email") return Boolean(r.email?.trim());
      return r.planEnd !== null;
    };
    const withVal = sorted.filter(hasValue).reverse();
    const without = sorted.filter((r) => !hasValue(r));
    return [...withVal, ...without];
  }
  return sorted.reverse();
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { finalizeIfExpired, getTakeState, getTestForUser } from "@/lib/tests";
import { TestRunner } from "@/components/test/test-runner";

export const metadata: Metadata = { title: "Test in progress" };

export default async function TakeTestPage(
  props: PageProps<"/tests/[id]/take">
) {
  const { id } = await props.params;
  const user = await requireUser();

  const existing = await getTestForUser(id, user.id);
  if (!existing) notFound();

  // If the deadline passed while the user was away, score it now and send
  // them to results instead of handing back a live-looking test.
  const test = await finalizeIfExpired(existing, user.id);
  if (test.status !== "in_progress") {
    redirect(`/tests/${id}/results`);
  }

  const state = await getTakeState(id, user.id);
  if (!state) notFound();

  return <TestRunner state={state} />;
}

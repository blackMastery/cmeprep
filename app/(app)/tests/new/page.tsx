import type { Metadata } from "next";
import { requireUser, hasTrialsRemaining } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewTestWizard } from "@/components/test/new-test-wizard";
import { TrialLimitCard } from "@/components/app/trial-limit-card";

export const metadata: Metadata = { title: "New test" };

export default async function NewTestPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: exams }, { data: specialties }, { data: subjects }, { data: topics }] =
    await Promise.all([
      supabase.from("exams").select("id, name").order("position"),
      supabase.from("specialties").select("id, name, exam_id").order("position"),
      supabase.from("subjects").select("id, name, specialty_id").order("position"),
      supabase.from("topics").select("id, name, subject_id").order("position"),
    ]);

  if (!hasTrialsRemaining(user.profile)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <TrialLimitCard profile={user.profile} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <NewTestWizard
        exams={(exams ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          specialties: (specialties ?? [])
            .filter((sp) => sp.exam_id === e.id)
            .map((sp) => ({
              id: sp.id,
              name: sp.name,
              subjects: (subjects ?? [])
                .filter((s) => s.specialty_id === sp.id)
                .map((s) => ({
                  id: s.id,
                  name: s.name,
                  topics: (topics ?? [])
                    .filter((t) => t.subject_id === s.id)
                    .map((t) => ({ id: t.id, name: t.name })),
                })),
            })),
        }))}
      />
    </div>
  );
}

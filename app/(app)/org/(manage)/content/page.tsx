import type { Metadata } from "next";
import { requireOrgAdmin } from "@/lib/orgs";
import { listHierarchy } from "@/lib/admin/taxonomy";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  OrgContentManager,
  type ContentTree,
} from "@/components/org/content-manager";

export const metadata: Metadata = { title: "Organisation content" };

export default async function OrgContentPage() {
  const session = await requireOrgAdmin();
  const hierarchy = await listHierarchy(session.org.id);

  const tree: ContentTree = hierarchy.map((exam) => ({
    id: exam.id,
    name: exam.name,
    specialties: exam.specialties.map((sp) => ({
      id: sp.id,
      name: sp.name,
      subjects: sp.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        questionCount: s.questionCount,
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/org/content/questions/new">
            <Plus data-icon="inline-start" />
            New question
          </Link>
        </Button>
      </div>
      <OrgContentManager tree={tree} />
    </div>
  );
}

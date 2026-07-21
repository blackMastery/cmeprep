import Link from "next/link";
import {
  CreditCard,
  FileText,
  FolderTree,
  GraduationCap,
  ListChecks,
  Plus,
  Users,
} from "lucide-react";
import { contentCounts } from "@/lib/admin/questions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminOverviewPage() {
  const counts = await contentCounts();

  const stats = [
    { icon: ListChecks, label: "Published questions", value: counts.published },
    { icon: FileText, label: "Drafts", value: counts.drafts },
    { icon: GraduationCap, label: "Exams", value: counts.exams },
    { icon: GraduationCap, label: "Specialties", value: counts.specialties },
    { icon: FolderTree, label: "Subjects", value: counts.subjects },
    { icon: FolderTree, label: "Topics", value: counts.topics },
    { icon: Users, label: "Users", value: counts.users },
    { icon: CreditCard, label: "Plans", value: counts.plans },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Content
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage the question bank and its subject hierarchy.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link href="/admin/questions/new">
            <Plus data-icon="inline-start" />
            New question
          </Link>
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="[--card-spacing:--spacing(5)]">
            <CardContent className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <stat.icon className="size-4" aria-hidden="true" />
                <span className="text-sm">{stat.label}</span>
              </div>
              <p className="font-display text-3xl font-semibold tabular-nums">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {counts.subjects === 0 && (
        <Card className="mt-6 [--card-spacing:--spacing(6)]">
          <CardContent className="space-y-3 text-center">
            <h2 className="font-display text-lg">Start with a subject</h2>
            <p className="text-sm text-muted-foreground">
              Questions live under a topic, and topics live under a subject.
            </p>
            <Button asChild>
              <Link href="/admin/subjects">Create a subject</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

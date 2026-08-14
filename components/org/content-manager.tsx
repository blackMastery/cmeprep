"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronRight, FileUp, Plus } from "lucide-react";
import {
  createOrgExam,
  createOrgSpecialty,
  createOrgSubject,
  deleteOrgExam,
  deleteOrgSpecialty,
  deleteOrgSubject,
  renameOrgExam,
  renameOrgSpecialty,
  renameOrgSubject,
} from "@/app/(app)/org/(manage)/content/actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Serializable tree the server page passes down. */
export type ContentTree = {
  id: string;
  name: string;
  specialties: {
    id: string;
    name: string;
    subjects: { id: string; name: string; questionCount: number }[];
  }[];
}[];

type Action = (
  prev: OrgActionState,
  formData: FormData
) => Promise<OrgActionState>;

/** One-line "add a child" form. */
function AddForm({
  action,
  hidden,
  placeholder,
}: {
  action: Action;
  hidden: Record<string, string>;
  placeholder: string;
}) {
  const [state, formAction] = useActionState<OrgActionState, FormData>(
    action,
    null
  );
  return (
    <div className="space-y-1">
      <form action={formAction} className="flex items-center gap-2">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Input name="name" placeholder={placeholder} className="h-8 max-w-64" />
        <Button type="submit" variant="outline" size="sm">
          <Plus data-icon="inline-start" />
          Add
        </Button>
      </form>
      <FormMessage error={state?.error} success={state?.success} />
    </div>
  );
}

/** Rename-in-place plus a guarded delete, shared by all three levels. */
function NodeActions({
  renameAction,
  deleteAction,
  hidden,
  name,
  deleteBlockedHint,
}: {
  renameAction: Action;
  deleteAction: Action;
  hidden: Record<string, string>;
  name: string;
  deleteBlockedHint?: string;
}) {
  const [renameState, rename] = useActionState<OrgActionState, FormData>(
    renameAction,
    null
  );
  const [deleteState, remove] = useActionState<OrgActionState, FormData>(
    deleteAction,
    null
  );

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={rename} className="flex items-center gap-2">
          {Object.entries(hidden).map(([n, v]) => (
            <input key={n} type="hidden" name={n} value={v} />
          ))}
          <Input name="name" defaultValue={name} className="h-8 max-w-64" />
          <Button type="submit" variant="ghost" size="sm">
            Rename
          </Button>
        </form>
        <form
          action={remove}
          onSubmit={(event) => {
            if (!window.confirm(`Delete "${name}"?`)) event.preventDefault();
          }}
        >
          {Object.entries(hidden).map(([n, v]) => (
            <input key={n} type="hidden" name={n} value={v} />
          ))}
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            title={deleteBlockedHint}
          >
            Delete
          </Button>
        </form>
      </div>
      <FormMessage
        error={renameState?.error ?? deleteState?.error}
        success={renameState?.success ?? deleteState?.success}
      />
    </div>
  );
}

export function OrgContentManager({ tree }: { tree: ContentTree }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your question bank</CardTitle>
          <CardDescription>
            Exams here are private to your organisation — members see them in
            the practice wizard alongside the public catalogue. Build the tree
            (exam → specialty → subject), then add questions by hand or import
            a workbook per exam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddForm
            action={createOrgExam}
            hidden={{}}
            placeholder="New exam, e.g. Internal Protocols 2026"
          />
        </CardContent>
      </Card>

      {tree.map((exam) => (
        <Card key={exam.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              {exam.name}
              <Button variant="outline" size="sm" asChild>
                <Link href={`/org/content/import/${exam.id}`}>
                  <FileUp data-icon="inline-start" />
                  Import questions
                </Link>
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <NodeActions
              renameAction={renameOrgExam}
              deleteAction={deleteOrgExam}
              hidden={{ examId: exam.id }}
              name={exam.name}
              deleteBlockedHint="Only empty exams can be deleted"
            />

            <div className="space-y-4 border-l border-border pl-4">
              {exam.specialties.map((specialty) => (
                <div key={specialty.id} className="space-y-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <ChevronRight
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {specialty.name}
                  </p>
                  <NodeActions
                    renameAction={renameOrgSpecialty}
                    deleteAction={deleteOrgSpecialty}
                    hidden={{ specialtyId: specialty.id }}
                    name={specialty.name}
                  />

                  <ul className="space-y-2 border-l border-border pl-4">
                    {specialty.subjects.map((subject) => (
                      <li key={subject.id} className="space-y-1">
                        <p className="text-sm">
                          {subject.name}{" "}
                          <Link
                            href={`/org/content/questions?subject=${subject.id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            {subject.questionCount} question
                            {subject.questionCount === 1 ? "" : "s"}
                          </Link>
                        </p>
                        <NodeActions
                          renameAction={renameOrgSubject}
                          deleteAction={deleteOrgSubject}
                          hidden={{ subjectId: subject.id }}
                          name={subject.name}
                        />
                      </li>
                    ))}
                    <li>
                      <AddForm
                        action={createOrgSubject}
                        hidden={{ specialtyId: specialty.id }}
                        placeholder="New subject"
                      />
                    </li>
                  </ul>
                </div>
              ))}
              <AddForm
                action={createOrgSpecialty}
                hidden={{ examId: exam.id }}
                placeholder="New specialty"
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

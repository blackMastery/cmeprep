"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { SubjectWithTopics } from "@/lib/admin/taxonomy";
import {
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  moveTopicQuestions,
  reorder,
  renameSubject,
  renameTopic,
  type AdminState,
} from "@/app/admin/subjects/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

export function SubjectManager({
  subjects,
}: {
  subjects: SubjectWithTopics[];
}) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createSubject,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">Add a subject</h2>
          <FormMessage error={createState?.error} success={createState?.success} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <Input
              name="name"
              placeholder="e.g. Ophthalmology"
              required
              className="h-10 max-w-xs flex-1"
            />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Add subject
            </AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {subjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No subjects yet. Add one above to get started.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {subjects.map((subject, index) => (
            <li key={subject.id}>
              <SubjectCard
                subject={subject}
                isFirst={index === 0}
                isLast={index === subjects.length - 1}
                allSubjects={subjects}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubjectCard({
  subject,
  isFirst,
  isLast,
  allSubjects,
}: {
  subject: SubjectWithTopics;
  isFirst: boolean;
  isLast: boolean;
  allSubjects: SubjectWithTopics[];
}) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameSubject,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteSubject,
    null
  );
  const [topicState, topicAction] = useActionState<AdminState, FormData>(
    createTopic,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        {/* Name gets its own full-width row: at 375px it cannot share a line
            with the badge and controls without truncating to a few letters. */}
        <div className="space-y-3">
          <form action={renameAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={subject.id} />
            <Input
              name="name"
              defaultValue={subject.name}
              aria-label={`Rename ${subject.name}`}
              className="h-10 min-w-0 flex-1 font-medium sm:max-w-xs"
            />
            <AdminSubmit variant="outline-muted" size="sm">
              Rename
            </AdminSubmit>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {subject.questionCount} question
              {subject.questionCount === 1 ? "" : "s"}
            </Badge>
            {subject.deletedCount > 0 && (
              <span className="text-xs text-muted-foreground">
                +{subject.deletedCount} deleted
              </span>
            )}

            <span className="ml-auto flex items-center gap-1">
              <ReorderButtons
                table="subjects"
                id={subject.id}
                isFirst={isFirst}
                isLast={isLast}
              />

          <form action={deleteAction}>
            <input type="hidden" name="id" value={subject.id} />
            <ConfirmSubmit
              variant="destructive"
              size="icon-sm"
              triggerLabel={`Delete ${subject.name}`}
              title={`Delete "${subject.name}"?`}
              confirmLabel="Delete subject"
              irreversible
              description={
                subject.topics.length > 0
                  ? `This permanently deletes the subject and its ${subject.topics.length} topic${subject.topics.length === 1 ? "" : "s"}.`
                  : "This permanently deletes the subject."
              }
            >
              <Trash2 />
            </ConfirmSubmit>
          </form>
            </span>
          </div>
        </div>

        <FormMessage error={renameState?.error} success={renameState?.success} />
        <FormMessage error={deleteState?.error} />

        <div className="space-y-2 border-t border-border pt-4">
          {subject.topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          ) : (
            <ul className="space-y-2">
              {subject.topics.map((topic, i) => (
                <li key={topic.id}>
                  <TopicRow
                    topic={topic}
                    subjectName={subject.name}
                    isFirst={i === 0}
                    isLast={i === subject.topics.length - 1}
                    allSubjects={allSubjects}
                  />
                </li>
              ))}
            </ul>
          )}

          <FormMessage error={topicState?.error} success={topicState?.success} />
          <form action={topicAction} className="flex flex-wrap gap-2 pt-1">
            <input type="hidden" name="subjectId" value={subject.id} />
            <Input
              name="name"
              placeholder="Add a topic…"
              required
              className="h-9 max-w-xs flex-1"
            />
            <AdminSubmit variant="outline-muted" size="sm">
              Add topic
            </AdminSubmit>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function TopicRow({
  topic,
  subjectName,
  isFirst,
  isLast,
  allSubjects,
}: {
  topic: SubjectWithTopics["topics"][number];
  subjectName: string;
  isFirst: boolean;
  isLast: boolean;
  allSubjects: SubjectWithTopics[];
}) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameTopic,
    null
  );
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteTopic,
    null
  );
  const [showMove, setShowMove] = useState(false);

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="space-y-2">
        <form action={renameAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={topic.id} />
          <Input
            name="name"
            defaultValue={topic.name}
            aria-label={`Rename ${topic.name}`}
            className="h-9 min-w-0 flex-1 text-sm sm:max-w-xs"
          />
          <AdminSubmit variant="ghost" size="xs">
            Save
          </AdminSubmit>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
        {topic.questionCount > 0 ? (
          <Button variant="ghost" size="xs" asChild>
            <Link href={`/admin/questions?topic=${topic.id}`}>
              {topic.questionCount} question
              {topic.questionCount === 1 ? "" : "s"}
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">empty</span>
        )}

        {/* Surfaced because deleted questions still block deleting the topic —
            without this, "empty" plus a refusal to delete makes no sense. */}
        {topic.deletedCount > 0 && (
          <Button variant="ghost" size="xs" asChild>
            <Link
              href={`/admin/questions?topic=${topic.id}&includeDeleted=1`}
              className="text-muted-foreground"
            >
              +{topic.deletedCount} deleted
            </Link>
          </Button>
        )}

        {topic.questionCount > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowMove((s) => !s)}
            aria-expanded={showMove}
          >
            {/* Short label on mobile, or this row wraps inconsistently
                between topics depending on name length. */}
            <span className="sm:hidden">Move</span>
            <span className="hidden sm:inline">Move questions</span>
          </Button>
        )}

        <span className="ml-auto flex items-center gap-1">
        <ReorderButtons
          table="topics"
          id={topic.id}
          isFirst={isFirst}
          isLast={isLast}
        />

        <form action={deleteAction}>
          <input type="hidden" name="id" value={topic.id} />
          <ConfirmSubmit
            size="icon-xs"
            triggerLabel={`Delete ${topic.name} from ${subjectName}`}
            title={`Delete "${topic.name}"?`}
            confirmLabel="Delete topic"
            irreversible
            description={`This permanently deletes the topic from ${subjectName}.`}
          >
            <Trash2 />
          </ConfirmSubmit>
        </form>
        </span>
        </div>
      </div>

      <FormMessage error={renameState?.error} />
      <FormMessage error={deleteState?.error} />

      {showMove && (
        <MoveQuestions
          fromTopicId={topic.id}
          count={topic.questionCount}
          allSubjects={allSubjects}
        />
      )}
    </div>
  );
}

function MoveQuestions({
  fromTopicId,
  count,
  allSubjects,
}: {
  fromTopicId: string;
  count: number;
  allSubjects: SubjectWithTopics[];
}) {
  const [state, action] = useActionState<AdminState, FormData>(
    moveTopicQuestions,
    null
  );

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">
        Moves all {count} question{count === 1 ? "" : "s"} to another topic.
        Note this rewrites per-topic analytics for every student who has
        already answered them.
      </p>
      <FormMessage error={state?.error} success={state?.success} />
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="fromTopicId" value={fromTopicId} />
        <select
          name="toTopicId"
          required
          defaultValue=""
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="" disabled>
            Move to…
          </option>
          {allSubjects.map((s) => (
            <optgroup key={s.id} label={s.name}>
              {s.topics
                .filter((t) => t.id !== fromTopicId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <AdminSubmit variant="outline-muted" size="sm">
          Move
        </AdminSubmit>
      </form>
    </div>
  );
}

function ReorderButtons({
  table,
  id,
  isFirst,
  isLast,
}: {
  table: "subjects" | "topics";
  id: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [, action] = useActionState<AdminState, FormData>(reorder, null);

  return (
    <span className="flex items-center">
      <form action={action}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="up" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isFirst}
          aria-label="Move up"
        >
          <ChevronUp />
        </Button>
      </form>
      <form action={action}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="direction" value="down" />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={isLast}
          aria-label="Move down"
        >
          <ChevronDown />
        </Button>
      </form>
    </span>
  );
}

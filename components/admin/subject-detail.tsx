"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { SubjectDetail as SubjectDetailData } from "@/lib/admin/taxonomy";
import {
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
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";
import { ConfirmSubmit } from "@/components/confirm-dialog";

/** Cross-specialty move destinations: "{specialty} › {subject}" groups. */
export type MoveGroup = {
  label: string;
  topics: { id: string; name: string }[];
};

/** Everything you can do to one subject, on its own page. */
export function SubjectDetail({
  subject,
  moveGroups,
}: {
  subject: SubjectDetailData;
  moveGroups: MoveGroup[];
}) {
  const [topicState, topicAction] = useActionState<AdminState, FormData>(
    createTopic,
    null
  );

  return (
    <div className="space-y-6">
      <SubjectSettingsCard subject={subject} />

      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-display text-lg">Topics</h2>
            <p className="text-xs text-muted-foreground">
              Questions are filed against a topic — this is the level the test
              builder selects on.
            </p>
          </div>

          {subject.topics.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No topics yet. Add the first one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {subject.topics.map((topic, i) => (
                <li key={topic.id}>
                  <TopicRow
                    topic={topic}
                    subjectName={subject.name}
                    isFirst={i === 0}
                    isLast={i === subject.topics.length - 1}
                    moveGroups={moveGroups}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border pt-4">
            <FormMessage error={topicState?.error} success={topicState?.success} />
            <form action={topicAction} className="flex flex-wrap gap-2 pt-1">
              <input type="hidden" name="subjectId" value={subject.id} />
              <Input
                name="name"
                placeholder="Add a topic…"
                aria-label={`Add a topic to ${subject.name}`}
                required
                className="h-9 max-w-xs flex-1"
              />
              <AdminSubmit variant="outline-muted" size="sm">
                <Plus data-icon="inline-start" />
                Add topic
              </AdminSubmit>
            </form>
          </div>
        </CardContent>
      </Card>

      <DangerZone subject={subject} />
    </div>
  );
}

function SubjectSettingsCard({ subject }: { subject: SubjectDetailData }) {
  const [renameState, renameAction] = useActionState<AdminState, FormData>(
    renameSubject,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <h2 className="font-display text-lg">Details</h2>
        <FormMessage error={renameState?.error} success={renameState?.success} />

        <form action={renameAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={subject.id} />

          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="subject-name">Name</Label>
            <Input
              id="subject-name"
              name="name"
              defaultValue={subject.name}
              required
              className="h-10 font-medium"
            />
          </div>

          <AdminSubmit variant="outline-muted">Save</AdminSubmit>
        </form>

        <p className="text-xs text-muted-foreground">
          Lives in {subject.examName} › {subject.specialtyName}. Renaming never
          moves it — subject names only have to be unique within a specialty.
        </p>
      </CardContent>
    </Card>
  );
}

function DangerZone({ subject }: { subject: SubjectDetailData }) {
  const [deleteState, deleteAction] = useActionState<AdminState, FormData>(
    deleteSubject,
    null
  );

  // Soft-deleted questions keep their FK, so they block the delete exactly
  // like live ones do. Count both or the button lies.
  const attached = subject.questionCount + subject.deletedCount;
  const blocked = attached > 0;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-3">
        <h2 className="font-display text-lg">Delete this subject</h2>
        <p className="text-sm text-muted-foreground">
          {blocked
            ? `${subject.name} still has ${attached} question${
                attached === 1 ? "" : "s"
              } filed under it${
                subject.deletedCount > 0
                  ? ` (${subject.deletedCount} of them deleted — those are kept so past papers stay intact)`
                  : ""
              }. Move them to another topic first.`
            : subject.topics.length > 0
              ? `This deletes ${subject.name} and its ${subject.topics.length} topic${
                  subject.topics.length === 1 ? "" : "s"
                }. No questions are filed under it.`
              : "This subject is empty, so deleting it loses nothing else."}
        </p>
        <FormMessage error={deleteState?.error} />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={subject.id} />
          <ConfirmSubmit
            variant="destructive"
            size="sm"
            disabled={blocked}
            triggerLabel={`Delete ${subject.name}`}
            title={`Delete "${subject.name}"?`}
            confirmLabel="Delete subject"
            irreversible
            description={
              subject.topics.length > 0
                ? `This permanently deletes the subject and its ${subject.topics.length} topic${subject.topics.length === 1 ? "" : "s"}, then returns you to ${subject.specialtyName}.`
                : `This permanently deletes the subject and returns you to ${subject.specialtyName}.`
            }
          >
            <Trash2 data-icon="inline-start" />
            Delete subject
          </ConfirmSubmit>
        </form>
      </CardContent>
    </Card>
  );
}

function TopicRow({
  topic,
  subjectName,
  isFirst,
  isLast,
  moveGroups,
}: {
  topic: SubjectDetailData["topics"][number];
  subjectName: string;
  isFirst: boolean;
  isLast: boolean;
  moveGroups: MoveGroup[];
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
            <SubjectReorderButtons
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
          moveGroups={moveGroups}
        />
      )}
    </div>
  );
}

function MoveQuestions({
  fromTopicId,
  count,
  moveGroups,
}: {
  fromTopicId: string;
  count: number;
  moveGroups: MoveGroup[];
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
          aria-label="Destination topic"
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="" disabled>
            Move to…
          </option>
          {moveGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.topics
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

/** Shared by the index cards (subjects) and this page's topic rows. */
export function SubjectReorderButtons({
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

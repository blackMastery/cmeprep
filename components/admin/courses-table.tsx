"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { createCourse } from "@/app/admin/courses/actions";
import type { AdminState } from "@/app/admin/subjects/actions";
import type { AdminCourseListItem } from "@/lib/admin/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormMessage } from "@/components/auth/form-parts";
import { AdminSubmit } from "@/components/admin/form-parts";

export function CoursesTable({
  items,
  showingDeleted,
}: {
  items: AdminCourseListItem[];
  showingDeleted: boolean;
}) {
  const [createState, createAction] = useActionState<AdminState, FormData>(
    createCourse,
    null
  );

  return (
    <div className="space-y-6">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-3">
          <h2 className="font-display text-lg">New CME course</h2>
          <FormMessage error={createState?.error} />
          <form action={createAction} className="flex flex-wrap gap-2">
            <Input
              name="title"
              placeholder="e.g. ECG Interpretation Basics"
              required
              className="h-10 max-w-sm flex-1"
            />
            <AdminSubmit>
              <Plus data-icon="inline-start" />
              Create draft
            </AdminSubmit>
          </form>
          <p className="text-xs text-muted-foreground">
            CME courses start as drafts — build modules and lessons, then
            publish.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" asChild>
          <Link
            href={showingDeleted ? "/admin/courses" : "/admin/courses?deleted=1"}
          >
            {showingDeleted ? "Hide deleted" : "Show deleted"}
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No CME courses yet. Create the first draft above.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lessons</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ course, lessonCount }) => (
                <TableRow key={course.id}>
                  <TableCell className="max-w-64">
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {course.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {course.deleted_at ? (
                      <Badge variant="destructive">Deleted</Badge>
                    ) : (
                      <Badge
                        variant={
                          course.status === "published" ? "default" : "secondary"
                        }
                      >
                        {course.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lessonCount}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(course.updated_at ?? course.created_at)
                      .toISOString()
                      .slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline-muted" size="sm" asChild>
                      <Link href={`/admin/courses/${course.id}`}>
                        Manage
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

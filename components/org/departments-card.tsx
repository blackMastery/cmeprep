"use client";

import { useActionState, useState } from "react";
import {
  createDepartment,
  deleteDepartment,
  renameDepartment,
} from "@/app/(app)/org/(manage)/members/department-actions";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";
import { AdminField, AdminSubmit } from "@/components/admin/form-parts";
import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type DepartmentItem = {
  id: string;
  name: string;
  memberCount: number;
};

function DepartmentRow({
  department,
  renameAction,
  deleteAction,
}: {
  department: DepartmentItem;
  renameAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 last:border-b-0">
      {renaming ? (
        <form
          action={(formData) => {
            setRenaming(false);
            renameAction(formData);
          }}
          className="flex flex-1 items-center gap-2"
        >
          <input type="hidden" name="departmentId" value={department.id} />
          <AdminField
            label="New name"
            name="name"
            id={`rename-${department.id}`}
            defaultValue={department.name}
            className="flex-1 [&>label]:sr-only"
            autoFocus
            required
          />
          <AdminSubmit size="sm">Save</AdminSubmit>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 text-sm font-medium">
            {department.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {department.memberCount} member
              {department.memberCount === 1 ? "" : "s"}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Delete ${department.name}? Its members become unassigned, and assignments targeting it will reach nobody.`
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="departmentId" value={department.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          </form>
        </>
      )}
    </li>
  );
}

export function DepartmentsCard({
  departments,
}: {
  departments: DepartmentItem[];
}) {
  const [createState, createAction] = useActionState<OrgActionState, FormData>(
    createDepartment,
    null
  );
  const [renameState, renameAction] = useActionState<OrgActionState, FormData>(
    renameDepartment,
    null
  );
  const [deleteState, deleteAction] = useActionState<OrgActionState, FormData>(
    deleteDepartment,
    null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>
          Group members by department or team — assign people below, target
          assignments at a department, and compare progress on the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={createAction} className="flex flex-wrap items-end gap-3">
          <AdminField
            label="New department"
            name="name"
            placeholder="e.g. Emergency"
            className="w-64"
            required
          />
          <AdminSubmit>Add department</AdminSubmit>
        </form>
        <FormMessage
          error={createState?.error ?? renameState?.error ?? deleteState?.error}
          success={
            createState?.success ??
            renameState?.success ??
            deleteState?.success
          }
        />
        {departments.length > 0 && (
          <ul>
            {departments.map((department) => (
              <DepartmentRow
                key={department.id}
                department={department}
                renameAction={renameAction}
                deleteAction={deleteAction}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ButtonProps = React.ComponentProps<typeof Button>;

type ConfirmCopy = {
  /** Question form, e.g. "Delete Cardiology?" */
  title: string;
  /** What actually happens, stated plainly. */
  description: React.ReactNode;
  /** Verb on the confirming button. */
  confirmLabel?: string;
  /** Extra emphasis for irreversible actions. */
  irreversible?: boolean;
};

function ConfirmBody({
  title,
  description,
  irreversible,
}: Pick<ConfirmCopy, "title" | "description" | "irreversible">) {
  return (
    <DialogHeader>
      <DialogTitle className="font-display text-xl">{title}</DialogTitle>
      <DialogDescription asChild>
        <div className="space-y-3 text-left">
          <p>{description}</p>
          {irreversible && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>This cannot be undone.</span>
            </p>
          )}
        </div>
      </DialogDescription>
    </DialogHeader>
  );
}

/**
 * Confirmation gate for a destructive Server Action.
 *
 * Place inside the `<form>` whose action should run. The visible trigger is a
 * plain button; only after confirming does a hidden submit button get clicked,
 * which is what actually invokes the action.
 *
 * A hidden submit button is used rather than `form.requestSubmit()` because it
 * goes through React's normal submit path, so `useFormStatus` pending state
 * and Server Action dispatch both behave exactly as they would on a click.
 */
export function ConfirmSubmit({
  title,
  description,
  confirmLabel = "Delete",
  irreversible = false,
  children,
  variant = "ghost",
  size = "xs",
  className,
  triggerLabel,
}: ConfirmCopy & {
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Accessible name when the trigger is icon-only. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const { pending } = useFormStatus();

  return (
    <>
      {/* The real submit, never shown. Kept out of the tab order so the
          confirm dialog is the only way to reach it. */}
      <button ref={submitRef} type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            className={className}
            disabled={pending}
            aria-busy={pending}
            aria-label={triggerLabel}
          >
            {pending ? "Working…" : children}
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-md">
          <ConfirmBody
            title={title}
            description={description}
            irreversible={irreversible}
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button variant="outline-muted">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                submitRef.current?.click();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Confirmation gate for a destructive action that is plain client state
 * rather than a form submit (removing an editor row, clearing an upload).
 */
export function ConfirmAction({
  title,
  description,
  confirmLabel = "Remove",
  irreversible = false,
  onConfirm,
  children,
  variant = "ghost",
  size = "xs",
  className,
  disabled,
  triggerLabel,
}: ConfirmCopy & {
  onConfirm: () => void;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          disabled={disabled}
          aria-label={triggerLabel}
        >
          {children}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <ConfirmBody
          title={title}
          description={description}
          irreversible={irreversible}
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline-muted">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Collects the name for CME certificates on a learner's FIRST progress write.
 *
 * Why here and not at signup or at download: browsing and reading stay
 * frictionless, but by the time anyone can finish a course the name exists —
 * so a certificate is never minted without a holder, and there is no
 * "unclaimed certificate" state to explain.
 *
 * The dialog's field and confirm button are bound to the lesson form by its
 * `form` id rather than by a ref: the dialog renders in a portal, outside the
 * form's DOM subtree, and the `form` attribute is what makes a portalled
 * control still submit with it. That also keeps native constraint validation
 * (required/minLength) doing the client-side checking for free.
 *
 * The gate is cosmetic. app/(app)/cme/actions.ts saves the name if the field
 * arrives and records progress either way: a learner who defeats this dialog
 * loses nothing but their certificate, which mints on their next course-page
 * visit once a name exists.
 */
export function useCredentialNameGate(needsName: boolean) {
  const formId = useId();
  const [open, setOpen] = useState(false);

  /** Put on the form itself so the portalled dialog controls can target it. */
  const formProps = { id: formId };

  function guard(event: React.MouseEvent<HTMLButtonElement>) {
    if (!needsName) return;
    event.preventDefault();
    setOpen(true);
  }

  const dialog = needsName ? (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your name for CME certificates</DialogTitle>
          <DialogDescription>
            Finish a course and you&apos;ll get a certificate of completion.
            Enter your name exactly as it should appear on it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="credential-name">Full professional name</Label>
          <Input
            id="credential-name"
            name="credentialName"
            form={formId}
            autoFocus
            required
            minLength={2}
            maxLength={80}
            placeholder="Dr. Jane Smith, MBBS"
            aria-describedby="credential-name-help"
          />
          <p id="credential-name-help" className="text-xs text-muted-foreground">
            Include any title or post-nominals you want printed. You can change
            this later in your profile.
          </p>
        </div>
        <DialogFooter>
          <Button type="submit" form={formId} onClick={() => setOpen(false)}>
            Save and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { formProps, guard, dialog };
}

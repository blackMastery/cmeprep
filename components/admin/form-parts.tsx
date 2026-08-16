"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Admin form controls. Separate from components/auth/form-parts.tsx because
 * those are tuned for the centred auth card (fixed h-11 inputs, full-width
 * submit); `FormMessage` is reused from there rather than duplicated.
 */

export function AdminField({
  label,
  name,
  hint,
  error,
  className,
  id,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}) {
  // The id defaults to the field name, but forms rendered per-row (e.g.
  // department renames) must pass a unique one — several rows can be open at
  // once, and duplicate ids point every label at the first input.
  const fieldId = id ?? name;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${fieldId}-hint` : undefined}
        className="h-10"
        {...props}
      />
      {(hint || error) && (
        <p
          id={`${fieldId}-hint`}
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function AdminTextarea({
  label,
  name,
  hint,
  error,
  className,
  ...props
}: React.ComponentProps<typeof Textarea> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {(hint || error) && (
        <p
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/**
 * Native <select> rather than Radix Select — it participates in FormData for
 * free, where the Radix version needs a shadow hidden input.
 */
export function AdminSelect({
  label,
  name,
  children,
  hint,
  error,
  className,
  ...props
}: React.ComponentProps<"select"> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        className="h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
        {...props}
      >
        {children}
      </select>
      {(hint || error) && (
        <p
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function AdminSubmit({
  children,
  className,
  variant,
  size = "default",
  name,
  value,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  /**
   * Lets one form carry two opposite submits (publish / unpublish): the
   * submitter's name and value land in FormData, so no hidden input is needed.
   */
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      {pending ? "Saving…" : children}
    </Button>
  );
}

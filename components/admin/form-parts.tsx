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
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${name}-hint` : undefined}
        className="h-10"
        {...props}
      />
      {(hint || error) && (
        <p
          id={`${name}-hint`}
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
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? "Saving…" : children}
    </Button>
  );
}

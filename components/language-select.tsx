"use client";

import { cn } from "@/lib/utils";
import { enabledRegistry } from "@/lib/translation-ui-core";

/** The student-side native <select> look — mirrors AdminSelect's. Kept here
 * rather than imported so student bundles don't pull in components/admin;
 * the picker's "request a language" select shares it. */
export const NATIVE_SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * Native <select> of the ENABLED translation languages plus a "none" option.
 * Native rather than Radix Select for the same reason as the admin forms: it
 * participates in FormData for free (the profile card posts it as a form),
 * and the wizard drives it as a controlled input.
 */
export function LanguageSelect({
  id,
  name,
  enabledLanguageCodes,
  noneLabel = "None — English only",
  className,
  ...control
}: {
  id: string;
  name?: string;
  enabledLanguageCodes: readonly string[];
  noneLabel?: string;
  className?: string;
} & (
  | { value: string | null; onChange: (code: string | null) => void; defaultValue?: never }
  | { defaultValue: string | null; value?: never; onChange?: never }
)) {
  const languages = enabledRegistry(enabledLanguageCodes);
  const valueProps =
    control.onChange !== undefined
      ? {
          value: control.value ?? "",
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            control.onChange(e.target.value || null),
        }
      : { defaultValue: control.defaultValue ?? "" };

  return (
    <select
      id={id}
      name={name}
      className={cn(NATIVE_SELECT_CLASS, className)}
      {...valueProps}
    >
      <option value="">{noneLabel}</option>
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.nativeName} ({l.name})
        </option>
      ))}
    </select>
  );
}

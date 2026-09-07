"use client";

import { ChevronDown, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { enabledRegistry } from "@/lib/translation-ui-core";
import { cn } from "@/lib/utils";

/**
 * The enabled translation languages as a button-shaped dropdown.
 *
 * Radix rather than the native <select> in LanguageSelect, because this one is
 * a controlled wizard step rather than a form field: nothing needs it to
 * participate in FormData, and the wizard's other controls are all buttons, so
 * a native select was the one browser-chrome control on the panel.
 *
 * LanguageSelect stays for the profile card — that IS a form field, posted by
 * a Server Action, and a menu posts nothing.
 *
 * RadioGroup, not plain items: exactly one language is in force, and the radio
 * role is what tells a screen reader which one, rather than leaving it to a
 * tick glyph.
 */
export function LanguageDropdown({
  id,
  value,
  onChange,
  enabledLanguageCodes,
  noneLabel = "None — English only",
  labelledBy,
  className,
}: {
  id: string;
  value: string | null;
  onChange: (code: string | null) => void;
  enabledLanguageCodes: readonly string[];
  noneLabel?: string;
  /** id of the visible label (a <legend>, usually). The trigger's own text is
   * the chosen language, which does not say what it selects. */
  labelledBy?: string;
  className?: string;
}) {
  const languages = enabledRegistry(enabledLanguageCodes);
  const selected = languages.find((l) => l.code === value);
  const label = selected ? `${selected.nativeName} (${selected.name})` : noneLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
          className={cn(
            "h-11 w-full justify-between gap-2 px-3 font-normal",
            // Nothing selected reads as a placeholder, not as a value.
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Languages
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      {/* No width or max-height here: DropdownMenuContent already matches the
          trigger width and caps itself at the available viewport height, with
          scrolling. Restating those would only be a second copy to drift. */}
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => onChange(next || null)}
        >
          <DropdownMenuRadioItem value="">{noneLabel}</DropdownMenuRadioItem>
          {languages.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code}>
              <span className="truncate">
                {l.nativeName} <span className="opacity-70">({l.name})</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

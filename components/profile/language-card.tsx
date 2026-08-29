"use client";

import { useActionState } from "react";
import {
  updatePreferredLanguage,
  type ProfileState,
} from "@/app/(app)/profile/actions";
import type { Profile } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FormMessage, SubmitButton } from "@/components/auth/form-parts";
import { LanguageSelect } from "@/components/language-select";
import { RequestLanguage } from "@/components/test/language-picker-dialog";

/**
 * The profile's translation setting: the language new tests start with
 * (each test then freezes its own), plus "request a language" for anything
 * in the registry that isn't switched on yet.
 */
export function LanguageCard({
  profile,
  enabledLanguageCodes,
}: {
  profile: Profile;
  enabledLanguageCodes: string[];
}) {
  const [state, formAction] = useActionState<ProfileState, FormData>(
    updatePreferredLanguage,
    null
  );

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-display text-lg">Translation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The exam is in English. Pick a language and every question gets a
            Translate button — one question at a time, on request.
          </p>
        </div>

        {enabledLanguageCodes.length > 0 ? (
          <form action={formAction} className="space-y-4">
            <FormMessage error={state?.error} success={state?.success} />
            <div className="space-y-2">
              <Label htmlFor="preferredLanguage">Translate new tests to</Label>
              <LanguageSelect
                id="preferredLanguage"
                name="preferredLanguage"
                enabledLanguageCodes={enabledLanguageCodes}
                defaultValue={profile.preferred_language}
              />
              <p className="text-xs text-muted-foreground">
                Seeds the language on new tests; you can still change it when
                starting one. Tests already started keep theirs.
              </p>
            </div>
            <SubmitButton>Save language</SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Translations aren&apos;t switched on yet — tell us which language
            you&apos;d use.
          </p>
        )}

        <RequestLanguage
          enabledLanguageCodes={enabledLanguageCodes}
          className="border-t border-border pt-4"
        />
      </CardContent>
    </Card>
  );
}

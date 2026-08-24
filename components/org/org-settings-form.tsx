"use client";

import { useActionState, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import {
  createOrgLogoUploadUrl,
  saveOrgLogo,
  updateOrgExamDate,
  updateOrgSettings,
} from "@/app/org/settings/actions";
import type { OrgActionState } from "@/app/org/members/actions";
import { createClient } from "@/lib/supabase/client";
import {
  ALLOWED_IMAGE_TYPES,
  ORG_BRANDING_BUCKET,
  orgLogoUrl,
} from "@/lib/storage";
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

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type SittingExam = {
  id: string;
  name: string;
  sittingOn: string | null;
};

export function OrgSettingsForm({
  name,
  passMarkPct,
  inactivityDays,
  logoPath,
  exams,
}: {
  name: string;
  passMarkPct: number;
  inactivityDays: number;
  logoPath: string | null;
  exams: SittingExam[];
}) {
  const [state, action] = useActionState<OrgActionState, FormData>(
    updateOrgSettings,
    null
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organisation settings</CardTitle>
          <CardDescription>
            The pass mark and inactivity window drive risk flagging on your
            dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <AdminField label="Name" name="name" defaultValue={name} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField
                label="Pass mark (%)"
                name="passMarkPct"
                type="number"
                min={1}
                max={100}
                defaultValue={passMarkPct}
                hint="Members whose accuracy sits below this are flagged."
              />
              <AdminField
                label="Inactivity window (days)"
                name="inactivityDays"
                type="number"
                min={1}
                max={90}
                defaultValue={inactivityDays}
                hint="No practice for this long also flags a member."
              />
            </div>
            <FormMessage error={state?.error} success={state?.success} />
            <AdminSubmit>Save settings</AdminSubmit>
          </form>
        </CardContent>
      </Card>

      {exams.length > 0 && <SittingDatesCard exams={exams} />}

      <LogoCard logoPath={logoPath} />
    </div>
  );
}

function SittingDatesCard({ exams }: { exams: SittingExam[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exam sittings</CardTitle>
        <CardDescription>
          When your cohort sits each exam. The date frames readiness on your
          dashboard (days remaining, urgency) — it never changes anyone&apos;s
          score. Leave blank if there&apos;s no fixed date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {exams.map((exam) => (
          <SittingDateRow key={exam.id} exam={exam} />
        ))}
      </CardContent>
    </Card>
  );
}

function SittingDateRow({ exam }: { exam: SittingExam }) {
  const [state, action] = useActionState<OrgActionState, FormData>(
    updateOrgExamDate,
    null
  );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="examId" value={exam.id} />
      <div className="flex flex-wrap items-end gap-3">
        <AdminField
          label={exam.name}
          name="sittingOn"
          type="date"
          defaultValue={exam.sittingOn ?? ""}
          className="min-w-44"
        />
        <AdminSubmit>Save</AdminSubmit>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}

function LogoCard({ logoPath }: { logoPath: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [state, action] = useActionState<OrgActionState, FormData>(
    saveOrgLogo,
    null
  );

  const url = orgLogoUrl(pendingPath ?? logoPath);

  async function handleFile(file: File) {
    setUploadError(null);
    if (
      !ALLOWED_IMAGE_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_TYPES)[number]
      )
    ) {
      setUploadError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setUploadError("Logos must be 2 MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      const signed = await createOrgLogoUploadUrl(file.type);
      if (!signed.ok) {
        setUploadError(signed.error);
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(ORG_BRANDING_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) {
        setUploadError("Upload failed. Try again.");
        return;
      }
      setPendingPath(signed.path);
      // Uploaded and staged — persist immediately so a closed tab can't
      // orphan the choice.
      requestAnimationFrame(() => formRef.current?.requestSubmit());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Shown to your members in the app next to the CMEPrep brand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          {url ? (
            // Plain <img>: tiny asset, arbitrary aspect ratio — the image
            // optimizer would add nothing but config surface.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="Organisation logo"
              className="h-12 w-auto max-w-48 rounded-md border border-border bg-card object-contain p-1"
            />
          ) : (
            <span className="flex h-12 w-24 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
              <ImagePlus className="size-5" aria-hidden="true" />
            </span>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Uploading…
              </>
            ) : (
              "Upload logo"
            )}
          </Button>

          {logoPath && !pendingPath && (
            <form action={action}>
              <input type="hidden" name="remove" value="true" />
              <Button
                type="submit"
                variant="ghost"
                className="text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </form>
          )}
        </div>

        <form ref={formRef} action={action}>
          <input type="hidden" name="logoPath" value={pendingPath ?? ""} />
        </form>

        <FormMessage
          error={uploadError ?? state?.error}
          success={state?.success}
        />
      </CardContent>
    </Card>
  );
}

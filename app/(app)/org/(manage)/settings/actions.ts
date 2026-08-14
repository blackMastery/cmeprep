"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/orgs";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import {
  ALLOWED_IMAGE_TYPES,
  extensionForType,
  ORG_BRANDING_BUCKET,
} from "@/lib/storage";
import { orgNameSchema } from "@/lib/validation";
import type { OrgActionState } from "@/app/(app)/org/(manage)/members/actions";

/** requireOrgAdmin() first, outside try/catch — house rule. */

function revalidateSettings() {
  revalidatePath("/org/settings");
  // The shell shows the branding on every page.
  revalidatePath("/", "layout");
}

function intInRange(raw: FormDataEntryValue | null, min: number, max: number) {
  const value = Number(String(raw ?? "").trim());
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

export async function updateOrgSettings(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const name = orgNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  // Bounds mirror the DB checks so failures are sentences, not constraint
  // violations.
  const passMark = intInRange(formData.get("passMarkPct"), 1, 100);
  if (passMark === null) return { error: "Pass mark must be 1–100%." };
  const inactivityDays = intInRange(formData.get("inactivityDays"), 1, 90);
  if (inactivityDays === null) {
    return { error: "Inactivity window must be 1–90 days." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("orgs")
    .update({
      name: name.data,
      pass_mark_pct: passMark,
      risk_inactivity_days: inactivityDays,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.org.id);
  if (error) return { error: "Could not save the settings." };

  await audit(
    session.user.id,
    "org.update",
    session.org.id,
    {
      before: {
        name: session.org.name,
        passMarkPct: session.org.pass_mark_pct,
        inactivityDays: session.org.risk_inactivity_days,
      },
      after: { name: name.data, passMarkPct: passMark, inactivityDays },
    },
    session.org.id
  );
  revalidateSettings();
  return { success: "Settings saved." };
}

/**
 * Signed upload URL for the logo — bytes go browser → Storage directly,
 * same pattern as question images. Path is pinned under the org's prefix.
 */
export async function createOrgLogoUploadUrl(
  contentType: string
): Promise<
  { ok: true; path: string; token: string } | { ok: false; error: string }
> {
  const session = await requireOrgAdmin();

  if (
    !ALLOWED_IMAGE_TYPES.includes(
      contentType as (typeof ALLOWED_IMAGE_TYPES)[number]
    )
  ) {
    return { ok: false, error: "Only PNG, JPEG or WebP images are allowed." };
  }
  const ext = extensionForType(contentType);
  if (!ext) return { ok: false, error: "Unsupported image type." };

  const path = `org/${session.org.id}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await createAdminClient()
    .storage.from(ORG_BRANDING_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Could not start the upload." };
  return { ok: true, path: data.path, token: data.token };
}

export async function saveOrgLogo(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const session = await requireOrgAdmin();

  const path = String(formData.get("logoPath") ?? "");
  const remove = formData.get("remove") === "true";

  // The path must be one WE minted for THIS org — anything else could point
  // the shell's <img> at another org's (or an arbitrary) object.
  if (!remove && !path.startsWith(`org/${session.org.id}/`)) {
    return { error: "Upload the logo first." };
  }

  const admin = createAdminClient();
  const previous = session.org.logo_path;

  const { error } = await admin
    .from("orgs")
    .update({
      logo_path: remove ? null : path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.org.id);
  if (error) return { error: "Could not save the logo." };

  // Best effort — an orphaned object costs cents, a failed save costs trust.
  if (previous && previous !== path) {
    await admin.storage.from(ORG_BRANDING_BUCKET).remove([previous]);
  }

  await audit(
    session.user.id,
    "org.update",
    session.org.id,
    { logo: remove ? null : path, before: previous },
    session.org.id
  );
  revalidateSettings();
  return { success: remove ? "Logo removed." : "Logo saved." };
}

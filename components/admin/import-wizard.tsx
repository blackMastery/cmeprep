"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { createImportUploadUrl } from "@/app/admin/questions/actions";
import type {
  ImportCommitRequest,
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportReport,
  ImportRequest,
} from "@/lib/admin/import-api";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/admin/import-api";
import type { Severity } from "@/lib/admin/import-core";
import { createClient } from "@/lib/supabase/client";
import { QUESTION_IMPORT_BUCKET } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Phase =
  | { name: "pick" }
  | { name: "uploading" }
  | { name: "previewing" }
  | { name: "previewed"; fileSha256: string; report: ImportReport }
  | { name: "committing"; fileSha256: string; report: ImportReport }
  | { name: "done"; result: Extract<ImportCommitResponse, { ok: true }> };

export function ImportWizard({
  examId,
  examName,
  questionsHref = "/admin/questions?published=false",
}: {
  examId: string;
  examName: string;
  /** Where "Review drafts" lands — the org surface passes its own list. */
  questionsHref?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // Storage path of the uploaded workbook. Both endpoints read the file from
  // there, so the bytes leave the browser exactly once no matter how many
  // times preview is re-run — which matters because a sheet with embedded
  // pictures is measured in megabytes, not kilobytes.
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [autoCreate, setAutoCreate] = useState(true);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(next: File | null) {
    setError(null);
    setPhase({ name: "pick" });
    // A different file invalidates whatever is already in Storage.
    setObjectPath(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose an .xlsx file — the template download gives you the right format.");
      return;
    }
    if (next.size > MAX_IMPORT_FILE_BYTES) {
      setError("Files are limited to 25 MB. Split the sheet and import in parts.");
      return;
    }
    setFile(next);
  }

  /**
   * Upload once, reuse for preview and commit. Bytes go straight to Supabase
   * Storage with a one-time signed URL — same trick as the question editor's
   * image field — so they never hit the serverless request-body limit.
   */
  async function ensureUploaded(current: File): Promise<string | null> {
    if (objectPath) return objectPath;

    setPhase({ name: "uploading" });
    const signed = await createImportUploadUrl();
    if (!signed.ok) {
      setError(signed.error);
      setPhase({ name: "pick" });
      return null;
    }

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(QUESTION_IMPORT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, current);

    if (uploadError) {
      setError("Upload failed — check your connection and try again.");
      setPhase({ name: "pick" });
      return null;
    }

    setObjectPath(signed.path);
    return signed.path;
  }

  async function preview() {
    if (!file) return;
    setError(null);
    try {
      const path = await ensureUploaded(file);
      if (!path) return;

      setPhase({ name: "previewing" });
      const payload: ImportRequest = {
        objectPath: path,
        examId,
        autoCreate,
        fileName: file.name,
      };
      const res = await fetch("/api/admin/questions-import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ImportPreviewResponse;
      if (!data.ok) {
        setError(data.error);
        setPhase({ name: "pick" });
        return;
      }
      setPhase({
        name: "previewed",
        fileSha256: data.fileSha256,
        report: data.report,
      });
    } catch {
      setError("Preview failed — check your connection and try again.");
      setPhase({ name: "pick" });
    }
  }

  async function commit() {
    if (!file || !objectPath || phase.name !== "previewed") return;
    setError(null);
    const { fileSha256, report } = phase;
    setPhase({ name: "committing", fileSha256, report });
    try {
      const payload: ImportCommitRequest = {
        objectPath,
        examId,
        autoCreate,
        fileName: file.name,
        fileSha256,
      };
      const res = await fetch("/api/admin/questions-import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ImportCommitResponse;
      if (!data.ok) {
        setError(data.error);
        setPhase(
          data.report
            ? { name: "previewed", fileSha256, report: data.report }
            : { name: "pick" }
        );
        return;
      }
      // Commit consumed the object; a retry has to upload again.
      setObjectPath(null);
      setPhase({ name: "done", result: data });
    } catch {
      setError("Import failed — check your connection and try again.");
      setPhase({ name: "previewed", fileSha256, report });
    }
  }

  if (phase.name === "done") {
    return (
      <SuccessPanel
        result={phase.result}
        examName={examName}
        questionsHref={questionsHref}
      />
    );
  }

  const busy =
    phase.name === "uploading" ||
    phase.name === "previewing" ||
    phase.name === "committing";
  const report =
    phase.name === "previewed" || phase.name === "committing"
      ? phase.report
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm">
        Importing into{" "}
        <span className="font-medium text-foreground">{examName}</span>
        . Every row files under this exam — the template has no Exam column.
      </div>

      {/* Step 1: template */}
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">1 · Fill in the template</h2>
            <p className="text-sm text-muted-foreground">
              One row per question for {examName}. The two example rows show
              the format and are ignored on import. For a question with a
              figure, put a picture in the <strong>Image</strong> column — both
              &ldquo;Place over Cells&rdquo; and &ldquo;Place in Cell&rdquo;
              work — or paste an https:// link to one.
            </p>
          </div>
          <Button variant="outline" asChild>
            {/* Plain anchor: a file download, not a client navigation. */}
            <a href="/api/admin/questions-import/template" download>
              <Download data-icon="inline-start" />
              Download template
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: upload */}
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="space-y-4">
          <h2 className="font-display text-lg">2 · Upload and check</h2>

          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              chooseFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging
                ? "border-primary bg-accent"
                : "border-border hover:border-primary/50 hover:bg-accent/50"
            )}
          >
            <FileSpreadsheet className="size-8 text-primary" aria-hidden="true" />
            {file ? (
              <>
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB · click to choose a
                  different file
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  Drop your .xlsx here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Up to 25 MB, including any pictures
                </p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoCreate}
              onChange={(e) => setAutoCreate(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              Create missing specialties and subjects under this exam
              automatically
              <span className="block text-xs text-muted-foreground">
                Turn off to treat unknown names as row errors.
              </span>
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <Button onClick={preview} disabled={!file || busy} size="lg">
            {phase.name === "uploading" ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Uploading…
              </>
            ) : phase.name === "previewing" ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Checking…
              </>
            ) : (
              <>
                <Upload data-icon="inline-start" />
                Check file
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Step 3: report + commit */}
      {report && (
        <ReportPanel
          report={report}
          committing={phase.name === "committing"}
          onCommit={commit}
        />
      )}
    </div>
  );
}

/**
 * A bad file can produce a message per row, so this list is bounded by the
 * import cap rather than by anything the admin did. Rendering two thousand
 * table rows to say the same thing twenty times over helps nobody.
 */
const MAX_SHOWN_LINES = 200;

const SEVERITY_META: Record<
  Severity,
  { label: string; className: string; icon: typeof Info }
> = {
  error: {
    label: "Error",
    className: "bg-destructive/10 text-destructive",
    icon: X,
  },
  warning: {
    label: "Warning",
    className: "bg-sun/25 text-foreground",
    icon: AlertTriangle,
  },
  info: { label: "Info", className: "bg-muted text-muted-foreground", icon: Info },
};

function ReportPanel({
  report,
  committing,
  onCommit,
}: {
  report: ImportReport;
  committing: boolean;
  onCommit: () => void;
}) {
  const { counts } = report;

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg">3 · Review and import</h2>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Badge className="bg-success text-success-foreground">
              {counts.valid} valid
            </Badge>
            {counts.withImages > 0 && (
              <Badge variant="secondary">{counts.withImages} with images</Badge>
            )}
            {counts.errorRows > 0 && (
              <Badge variant="destructive">{counts.errorRows} with errors</Badge>
            )}
            {counts.warnings > 0 && (
              <Badge variant="secondary">{counts.warnings} warnings</Badge>
            )}
            {counts.skipped > 0 && (
              <Badge variant="outline">{counts.skipped} example rows</Badge>
            )}
          </span>
        </div>

        {report.fileErrors.length > 0 && (
          <div className="space-y-1.5">
            {report.fileErrors.map((message) => (
              <p
                key={message}
                className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {message}
              </p>
            ))}
          </div>
        )}

        {report.lines.length > 0 ? (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead className="w-28">Severity</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lines.slice(0, MAX_SHOWN_LINES).map((line, index) => {
                  const meta = SEVERITY_META[line.severity];
                  return (
                    <TableRow key={index}>
                      <TableCell className="tabular-nums">
                        {line.row ?? "file"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            meta.className
                          )}
                        >
                          <meta.icon className="size-3" aria-hidden="true" />
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{line.message}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {report.lines.length > MAX_SHOWN_LINES && (
              <p className="border-t border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                Showing the first {MAX_SHOWN_LINES} of {report.lines.length}{" "}
                messages. Fix these and re-run the preview to see the rest.
              </p>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Every row passed validation.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            size="lg"
            onClick={onCommit}
            disabled={counts.valid === 0 || committing}
          >
            {committing ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" />
                Importing…
              </>
            ) : (
              `Import ${counts.valid} draft${counts.valid === 1 ? "" : "s"}`
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Everything imports unpublished. Rows with errors are skipped.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SuccessPanel({
  result,
  examName,
  questionsHref,
}: {
  result: Extract<ImportCommitResponse, { ok: true }>;
  examName: string;
  questionsHref: string;
}) {
  return (
    <Card className="[--card-spacing:--spacing(7)]">
      <CardContent className="space-y-5 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>

        <div className="space-y-2">
          <h2 className="font-display text-2xl font-semibold">
            Imported {result.imported} draft
            {result.imported === 1 ? "" : "s"}
            {result.images > 0 && ` with ${result.images} image${result.images === 1 ? "" : "s"}`}
          </h2>
          {(result.createdSpecialties.length > 0 ||
            result.createdSubjects.length > 0) && (
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Created under {examName}:{" "}
              {[
                result.createdSpecialties.length > 0 &&
                  `specialties: ${result.createdSpecialties.join(", ")}`,
                result.createdSubjects.length > 0 &&
                  `subjects: ${result.createdSubjects.join(", ")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Review them, then publish when ready — drafts never appear in
            tests.
          </p>
        </div>

        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button size="lg" asChild>
            <Link href={questionsHref}>Review drafts</Link>
          </Button>
 
        </div>
      </CardContent>
    </Card>
  );
}

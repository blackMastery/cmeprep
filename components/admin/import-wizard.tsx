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
import type {
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportReport,
} from "@/lib/admin/import-api";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/admin/import-api";
import type { Severity } from "@/lib/admin/import-core";
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
  | { name: "previewing" }
  | { name: "previewed"; fileSha256: string; report: ImportReport }
  | { name: "committing"; fileSha256: string; report: ImportReport }
  | { name: "done"; result: Extract<ImportCommitResponse, { ok: true }> };

export function ImportWizard() {
  const inputRef = useRef<HTMLInputElement>(null);
  // The File lives in React state so it survives past preview — commit
  // re-sends the same bytes and the server verifies the sha256 matches.
  const [file, setFile] = useState<File | null>(null);
  const [autoCreate, setAutoCreate] = useState(true);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(next: File | null) {
    setError(null);
    setPhase({ name: "pick" });
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose an .xlsx file — the template download gives you the right format.");
      return;
    }
    if (next.size > MAX_IMPORT_FILE_BYTES) {
      setError("Files are limited to 4 MB. Split the sheet and import in parts.");
      return;
    }
    setFile(next);
  }

  async function preview() {
    if (!file) return;
    setError(null);
    setPhase({ name: "previewing" });
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("autoCreate", String(autoCreate));
      const res = await fetch("/api/admin/questions-import/preview", {
        method: "POST",
        body,
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
    if (!file || phase.name !== "previewed") return;
    setError(null);
    const { fileSha256, report } = phase;
    setPhase({ name: "committing", fileSha256, report });
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("autoCreate", String(autoCreate));
      body.set("fileSha256", fileSha256);
      const res = await fetch("/api/admin/questions-import/commit", {
        method: "POST",
        body,
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
      setPhase({ name: "done", result: data });
    } catch {
      setError("Import failed — check your connection and try again.");
      setPhase({ name: "previewed", fileSha256, report });
    }
  }

  if (phase.name === "done") {
    return <SuccessPanel result={phase.result} />;
  }

  const busy = phase.name === "previewing" || phase.name === "committing";
  const report =
    phase.name === "previewed" || phase.name === "committing"
      ? phase.report
      : null;

  return (
    <div className="space-y-6">
      {/* Step 1: template */}
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">1 · Fill in the template</h2>
            <p className="text-sm text-muted-foreground">
              One row per question. The two example rows show the format and
              are ignored on import.
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
                <p className="text-xs text-muted-foreground">Up to 4 MB</p>
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
              Create missing subjects and topics automatically
              <span className="block text-xs text-muted-foreground">
                Turn off to treat unknown subject/topic names as row errors.
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
            {phase.name === "previewing" ? (
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
                {report.lines.map((line, index) => {
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
}: {
  result: Extract<ImportCommitResponse, { ok: true }>;
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
          </h2>
          {(result.createdSubjects.length > 0 ||
            result.createdTopics.length > 0) && (
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Created{" "}
              {[
                result.createdSubjects.length > 0 &&
                  `subjects: ${result.createdSubjects.join(", ")}`,
                result.createdTopics.length > 0 &&
                  `topics: ${result.createdTopics.join(", ")}`,
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
            <Link href="/admin/questions?published=false">Review drafts</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/admin/questions/import">Import another file</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

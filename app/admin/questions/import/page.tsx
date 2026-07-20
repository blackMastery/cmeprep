import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "@/components/admin/import-wizard";

export const metadata: Metadata = { title: "Import questions" };

export default function ImportQuestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/questions">
            <ArrowLeft data-icon="inline-start" />
            Questions
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Import from Excel
        </h1>
      </div>

      <ImportWizard />
    </div>
  );
}

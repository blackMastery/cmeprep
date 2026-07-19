import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { EcgDivider } from "@/components/brand/ecg-line";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <EcgDivider className="max-w-xs text-primary/30" />
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Page not found</h1>
        <p className="max-w-sm text-muted-foreground">
          That page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}

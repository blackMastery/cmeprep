import { EcgLine } from "@/components/brand/ecg-line";

export default function TakeLoading() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <EcgLine className="h-10 w-40 text-primary" animate strokeWidth={2} />
      <p className="text-sm text-muted-foreground">Preparing your test…</p>
    </div>
  );
}

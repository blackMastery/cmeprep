import { cn } from "@/lib/utils";

/** The small muted figure in an admin page's summary strip (OSCE grading,
 * translations). `warn` paints the value destructive — failed calls today. */
export function SummaryTile({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-display text-lg tabular-nums",
          warn && "text-destructive"
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

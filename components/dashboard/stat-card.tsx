import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          <span className="text-sm">{label}</span>
        </div>
        <p className="font-display text-3xl font-semibold tabular-nums">
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

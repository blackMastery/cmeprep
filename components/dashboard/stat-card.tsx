import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  /**
   * "teal" marks a figure that means progress toward passing. A raw count
   * with no pass/fail reading (questions attempted) stays neutral — colouring
   * everything green would empty the colour of meaning.
   */
  tone?: "default" | "teal";
}) {
  const teal = tone === "teal";

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="space-y-1">
        {/* Only the icon takes --teal. The label is small text, and --teal is
            3.15:1 on cream — fine for a glyph (WCAG 1.4.11), short of AA for
            words. So the label keeps the muted foreground. */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon
            className={cn("size-4", teal && "text-teal")}
            aria-hidden="true"
          />
          <span className="text-sm">{label}</span>
        </div>
        {/* --teal-deep, not --teal: this is text, and only the deep step
            clears AA on the cream background. */}
        <p
          className={cn(
            "font-display text-3xl font-semibold tabular-nums",
            teal && "text-teal-deep"
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

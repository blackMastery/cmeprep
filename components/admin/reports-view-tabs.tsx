import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Open / resolved switch — the same Button+Link idiom as the messages
 * page's filter nav, so it inherits theme tweaks with it. */
export function ReportsViewTabs({
  basePath,
  view,
}: {
  basePath: string;
  view: "open" | "resolved";
}) {
  const tabs = [
    { key: "open" as const, label: "Open", href: basePath },
    { key: "resolved" as const, label: "Resolved", href: `${basePath}?view=resolved` },
  ];
  return (
    <nav aria-label="Report views" className="flex items-center gap-1">
      {tabs.map((t) => (
        <Button
          key={t.key}
          variant={view === t.key ? "default" : "ghost"}
          size="sm"
          asChild
        >
          <Link href={t.href} aria-current={view === t.key ? "page" : undefined}>
            {t.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

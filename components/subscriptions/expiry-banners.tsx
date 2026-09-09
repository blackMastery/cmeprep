import { listActivePlans } from "@/lib/plans";
import { renewHref, renewPlan } from "@/lib/plans-core";
import { listExamCatalog } from "@/lib/catalog";
import { expiryWarnings } from "@/lib/entitlements-core";
import type { SubscriptionScope } from "@/lib/entitlements-core";
import { ExpiryBanner } from "@/components/subscriptions/expiry-banner";

/** Two is the ceiling: past that the page turns into a wall of warnings. */
const MAX_BANNERS = 2;

/**
 * Every exam whose access ends soon, soonest first.
 *
 * Access is per exam now, so a single global banner would stay silent when
 * one exam lapses and another runs for months. Renders nothing — not even a
 * query — when nothing is expiring.
 */
export async function ExpiryBanners({
  subscriptions,
}: {
  subscriptions: SubscriptionScope[];
}) {
  const warnings = expiryWarnings(subscriptions, new Date()).slice(0, MAX_BANNERS);
  if (warnings.length === 0) return null;

  const [catalog, plans] = await Promise.all([
    listExamCatalog(),
    listActivePlans(),
  ]);

  // Same rule as the expiry reminder EMAIL (lib/notification-scans.ts): the
  // two must never point a student at different plans.
  const plan = renewPlan(plans);
  const nameById = new Map(catalog.map((exam) => [exam.id, exam.name]));

  return (
    <>
      {warnings.map((warning) => (
        <ExpiryBanner
          key={warning.examId ?? "all"}
          periodEnd={warning.periodEnd}
          daysLeft={warning.daysLeft}
          examName={
            warning.examId ? (nameById.get(warning.examId) ?? null) : null
          }
          renewHref={renewHref(plan, warning.examId)}
        />
      ))}
    </>
  );
}

"use client";

import { usePathname } from "next/navigation";

/**
 * Hides the app nav while a test is being taken. The take screen has its own
 * sticky bar (timer, progress, autosave) and should stay distraction-free —
 * stacking two headers both wastes vertical space on a phone and undercuts
 * the focused feel the test screen is going for.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTakingTest = /^\/tests\/[^/]+\/take$/.test(pathname);

  if (isTakingTest) return null;

  return <>{children}</>;
}

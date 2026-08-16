"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one client-side test launcher: POST /api/tests with a server-resolved
 * prescription reference (assignment id, plan goal, …), then straight into
 * the runner. Shared by the assignment and plan Start buttons so the error
 * fallback chain and the take-route path are stated once.
 */
export function useLaunchTest() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch(
    body: Record<string, unknown>,
    opts?: { onErrorCode?: (code: string | undefined) => void }
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "Could not start the test.");
        setBusy(false);
        opts?.onErrorCode?.(data?.error);
        return;
      }
      router.push(`/tests/${data.id}/take`);
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  return { busy, error, launch, router };
}

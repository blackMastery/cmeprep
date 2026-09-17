"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Toast once for something that happened on the PREVIOUS page, signalled by
 * a query param the server redirect added (e.g. /org/assignments?created=1).
 *
 * The param is stripped with a replace as soon as it fires, so a refresh or
 * a shared link does not re-announce it, and the ref guards the double
 * invocation React runs in development.
 */
export function FlashToast({ message }: { message: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    toast.success(message);
    router.replace(pathname, { scroll: false });
  }, [message, pathname, router]);

  return null;
}

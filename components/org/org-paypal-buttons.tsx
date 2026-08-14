"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";

/**
 * PayPal Smart Buttons for an ORG plan. Same trust model as the personal
 * checkout buttons: the browser only shuttles opaque order ids, the server
 * picks the amount and verifies the payer is this org's admin. Success stays
 * on the billing page — /checkout/success is personal-checkout copy.
 *
 * The gap between PayPal approval and OUR capture round-trip (capture API +
 * grant + refresh) is seconds long and used to render nothing — a paying
 * buyer staring at a silent page. `phase` covers it end to end: the
 * indicator holds through the capture AND the router.refresh() transition,
 * and the buttons stay disabled so a double-click can't mint a second order.
 */
export function OrgPayPalButtons({
  planId,
  orgId,
  examId,
}: {
  planId: string;
  orgId: string;
  /** The public exam this purchase buys — chosen by the picker above. */
  examId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "capturing" | "confirmed">(
    "idle"
  );
  const [refreshing, startRefresh] = useTransition();

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  if (!clientId) {
    return (
      <p className="text-sm text-destructive">
        Payments are not configured yet. Please try again later.
      </p>
    );
  }

  const busy = phase === "capturing" || refreshing;

  return (
    <div>
      <PayPalScriptProvider
        options={{ clientId, currency: "USD", intent: "capture" }}
      >
        <PayPalButtons
          // examId included: the SDK captures createOrder at first mount,
          // and a buyer who switches exams then pays must not buy the first.
          forceReRender={[planId, orgId, examId]}
          style={{ layout: "vertical", label: "pay" }}
          disabled={busy}
          createOrder={async () => {
            setError(null);
            const res = await fetch("/api/paypal/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ planId, orgId, examId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.id) {
              throw new Error(data?.error ?? "Could not start checkout");
            }
            return data.id as string;
          }}
          onApprove={async (data) => {
            setPhase("capturing");
            setError(null);
            try {
              const res = await fetch(
                `/api/paypal/orders/${data.orderID}/capture`,
                { method: "POST" }
              );
              const json = await res.json().catch(() => null);
              if (!res.ok || json?.status !== "COMPLETED") {
                setPhase("idle");
                setError(
                  json?.error === "grant_failed"
                    ? "Your payment went through but activation hit a snag — contact support and we'll sort it out."
                    : "The payment could not be completed. You can try again — you have not been charged."
                );
                return;
              }
              setPhase("confirmed");
              toast.success("Your organisation's plan is active.");
              // Inside a transition so `refreshing` keeps the indicator up
              // until the new dates actually render.
              startRefresh(() => router.refresh());
            } catch {
              setPhase("idle");
              setError(
                "Network error while confirming the payment. If you were charged, the access will still arrive — refresh in a minute or contact support."
              );
            }
          }}
          onCancel={() => {
            setPhase("idle");
            toast("Payment cancelled — you have not been charged.");
          }}
          onError={() => {
            setPhase("idle");
            setError(
              "Something went wrong with PayPal. Please try again in a moment."
            );
          }}
        />
      </PayPalScriptProvider>

      {phase === "capturing" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Confirming your payment — don&apos;t close this tab.
        </p>
      )}
      {phase === "confirmed" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-success"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          )}
          Payment confirmed — your team&apos;s access is active.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

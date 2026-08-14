"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  PayPalButtons,
  PayPalScriptProvider,
} from "@paypal/react-paypal-js";

/**
 * PayPal Smart Buttons for one plan and one exam. The browser only shuttles
 * opaque order ids: /api/paypal/orders picks the amount from the DB and
 * validates the exam, and the capture route grants access, so nothing here is
 * trusted.
 *
 * `capturing` covers the silent seconds between PayPal approval and our
 * capture + navigation — same fix as the org billing buttons.
 */
export function PayPalCheckoutButtons({
  planId,
  examId,
}: {
  planId: string;
  examId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  if (!clientId) {
    return (
      <p className="text-sm text-destructive">
        Payments are not configured yet. Please try again later.
      </p>
    );
  }

  return (
    <div>
      <PayPalScriptProvider
        options={{ clientId, currency: "USD", intent: "capture" }}
      >
        <PayPalButtons
          // The SDK captures createOrder at first mount. Without this, a
          // buyer who picks one exam, switches to another, then pays would
          // create an order for the FIRST one.
          forceReRender={[examId]}
          style={{ layout: "vertical", label: "pay" }}
          disabled={capturing}
          createOrder={async () => {
            setError(null);
            const res = await fetch("/api/paypal/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ planId, examId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.id) {
              throw new Error(data?.error ?? "Could not start checkout");
            }
            return data.id as string;
          }}
          onApprove={async (data) => {
            setCapturing(true);
            setError(null);
            try {
              const res = await fetch(
                `/api/paypal/orders/${data.orderID}/capture`,
                { method: "POST" }
              );
              const json = await res.json().catch(() => null);
              if (!res.ok || json?.status !== "COMPLETED") {
                setCapturing(false);
                setError(
                  json?.error === "grant_failed"
                    ? "Your payment went through but activation hit a snag — contact support and we'll sort it out."
                    : "The payment could not be completed. You can try again — you have not been charged."
                );
                return;
              }
              // `capturing` stays true on purpose: the indicator holds until
              // the success page takes over.
              router.refresh();
              router.push("/checkout/success");
            } catch {
              setCapturing(false);
              setError(
                "Network error while confirming the payment. If you were charged, the access will still arrive — refresh in a minute or contact support."
              );
            }
          }}
          onCancel={() => {
            setCapturing(false);
            toast("Payment cancelled — you have not been charged.");
          }}
          onError={() => {
            setCapturing(false);
            setError(
              "Something went wrong with PayPal. Please try again in a moment."
            );
          }}
        />
      </PayPalScriptProvider>

      {capturing && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Confirming your payment — don&apos;t close this tab.
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

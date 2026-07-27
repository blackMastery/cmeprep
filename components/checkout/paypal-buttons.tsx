"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
            const res = await fetch(
              `/api/paypal/orders/${data.orderID}/capture`,
              { method: "POST" }
            );
            const json = await res.json().catch(() => null);
            if (!res.ok || json?.status !== "COMPLETED") {
              setError(
                json?.error === "grant_failed"
                  ? "Your payment went through but activation hit a snag — contact support and we'll sort it out."
                  : "The payment could not be completed. You can try again — you have not been charged."
              );
              return;
            }
            router.refresh();
            router.push("/checkout/success");
          }}
          onCancel={() => {
            toast("Payment cancelled — you have not been charged.");
          }}
          onError={() => {
            setError(
              "Something went wrong with PayPal. Please try again in a moment."
            );
          }}
        />
      </PayPalScriptProvider>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

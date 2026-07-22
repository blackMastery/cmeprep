import "server-only";

/**
 * Minimal PayPal REST client (Orders v2 + webhook verification) over plain
 * fetch — no server SDK. All amounts are computed server-side from the DB;
 * the browser only ever sees opaque order ids.
 */

export const CURRENCY = "USD";

const API_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  }

  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`paypal_oauth_failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function paypalFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; json: PaypalOrder | null }> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** The subset of the Orders v2 response shape this app reads. */
export type PaypalOrder = {
  id: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id: string;
        status?: string;
        custom_id?: string;
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
  details?: Array<{ issue?: string }>;
};

export async function createPaypalOrder(input: {
  value: string;
  customId: string;
  referenceId: string;
}): Promise<{ id: string } | null> {
  const { status, json } = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          custom_id: input.customId,
          amount: { currency_code: CURRENCY, value: input.value },
        },
      ],
    }),
  });

  if (status !== 201 && status !== 200) {
    console.error("paypal_create_order_failed", { status, json });
    return null;
  }
  return json?.id ? { id: json.id } : null;
}

export type CaptureResult =
  | { kind: "completed"; order: PaypalOrder }
  | { kind: "already_captured" }
  | { kind: "failed"; status: number };

export async function capturePaypalOrder(
  orderId: string
): Promise<CaptureResult> {
  const { status, json } = await paypalFetch(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    { method: "POST", body: "{}" }
  );

  if ((status === 200 || status === 201) && json?.status === "COMPLETED") {
    return { kind: "completed", order: json };
  }
  if (
    status === 422 &&
    json?.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")
  ) {
    return { kind: "already_captured" };
  }
  console.error("paypal_capture_failed", { orderId, status, json });
  return { kind: "failed", status };
}

export async function getPaypalOrder(
  orderId: string
): Promise<PaypalOrder | null> {
  const { status, json } = await paypalFetch(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`
  );
  return status === 200 ? json : null;
}

/**
 * Verify a webhook delivery via PayPal's verify-webhook-signature API.
 * The event must be embedded in the request body BYTE-IDENTICAL to what
 * PayPal sent — re-serializing a parsed copy can reorder keys or re-escape
 * characters and fail verification — hence string concatenation of rawBody.
 */
export async function verifyWebhookSignature(input: {
  headers: Headers;
  rawBody: string;
}): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;

  const h = (name: string) => input.headers.get(name) ?? "";
  const body =
    `{"transmission_id":${JSON.stringify(h("paypal-transmission-id"))},` +
    `"transmission_time":${JSON.stringify(h("paypal-transmission-time"))},` +
    `"cert_url":${JSON.stringify(h("paypal-cert-url"))},` +
    `"auth_algo":${JSON.stringify(h("paypal-auth-algo"))},` +
    `"transmission_sig":${JSON.stringify(h("paypal-transmission-sig"))},` +
    `"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${input.rawBody}}`;

  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
    cache: "no-store",
  });

  if (!res.ok) return false;
  const json = (await res.json().catch(() => null)) as {
    verification_status?: string;
  } | null;
  return json?.verification_status === "SUCCESS";
}

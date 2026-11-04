import type Stripe from "stripe";

/**
 * Pure Stripe helpers shared by the admin settings UI, server Checkout code
 * and tests. This module contains no secrets and no Stripe API calls.
 */

export const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";

/** Thin event types recommended by Stripe for new event destinations. */
export const STRIPE_THIN_EVENT_TYPES = [
  "v1.checkout.session.completed",
  "v1.checkout.session.async_payment_succeeded",
  "v1.checkout.session.async_payment_failed",
  "v1.checkout.session.expired",
] as const;

/** Equivalent snapshot-event names; the endpoint accepts either destination format. */
export const STRIPE_SNAPSHOT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;

export type StripeKeyMode = "test" | "live";

export type StripeCredentialSource = "database" | "environment" | null;

/** Safe-to-render admin summary — this never contains a full secret. */
export type StripeAdminSummary = {
  enabled: boolean;
  publishableKey: string | null;
  hasSecretKey: boolean;
  secretKeyLast4: string | null;
  secretSource: StripeCredentialSource;
  hasWebhookSecret: boolean;
  webhookSecretLast4: string | null;
  webhookSource: StripeCredentialSource;
  mode: StripeKeyMode | null;
  configured: boolean;
  migrated: boolean;
  serviceRoleConfigured: boolean;
};

export const EMPTY_STRIPE_ADMIN_SUMMARY: StripeAdminSummary = {
  enabled: false,
  publishableKey: null,
  hasSecretKey: false,
  secretKeyLast4: null,
  secretSource: null,
  hasWebhookSecret: false,
  webhookSecretLast4: null,
  webhookSource: null,
  mode: null,
  configured: false,
  migrated: false,
  serviceRoleConfigured: false,
};

const PUBLISHABLE_KEY_RE = /^pk_(test|live)_[A-Za-z0-9_-]{8,}$/;
const SECRET_KEY_RE = /^(?:sk|rk)_(test|live)_[A-Za-z0-9_-]{8,}$/;
const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9_-]{8,}$/;

export function stripeKeyMode(value: string | null | undefined): StripeKeyMode | null {
  const key = value?.trim() ?? "";
  if (/^(?:pk|sk|rk)_test_/.test(key)) return "test";
  if (/^(?:pk|sk|rk)_live_/.test(key)) return "live";
  return null;
}

export function isValidStripePublishableKey(value: string | null | undefined): boolean {
  return PUBLISHABLE_KEY_RE.test(value?.trim() ?? "");
}

export function isValidStripeSecretKey(value: string | null | undefined): boolean {
  return SECRET_KEY_RE.test(value?.trim() ?? "");
}

export function isValidStripeWebhookSecret(value: string | null | undefined): boolean {
  return WEBHOOK_SECRET_RE.test(value?.trim() ?? "");
}

export function stripeSecretLast4(value: string | null | undefined): string | null {
  const key = value?.trim() ?? "";
  return key.length >= 4 ? key.slice(-4) : null;
}

export function isStripeConfigured(config: {
  enabled: boolean;
  secretKey?: string | null;
  webhookSecret?: string | null;
}): boolean {
  return Boolean(
    config.enabled &&
      isValidStripeSecretKey(config.secretKey) &&
      isValidStripeWebhookSecret(config.webhookSecret),
  );
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function getStripeCurrencyExponent(currency: string | null | undefined): number {
  const code = (currency ?? "USD").trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

function decimalToFraction(value: number | string | null | undefined): { numerator: bigint; denominator: bigint } {
  const raw = String(value ?? "1").trim();
  if (!raw || raw === "0") return { numerator: BigInt(1), denominator: BigInt(1) };

  // Number inputs from JSON can use exponent notation; normalise through a
  // fixed decimal string before doing integer money maths.
  const normalized = /e/i.test(raw) ? Number(raw).toFixed(8) : raw;
  const match = /^([0-9]+)(?:\.([0-9]*))?$/.exec(normalized);
  if (!match) return { numerator: BigInt(1), denominator: BigInt(1) };

  const whole = match[1];
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (!fraction) return { numerator: BigInt(whole || "1"), denominator: BigInt(1) };
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: BigInt(10) ** BigInt(fraction.length),
  };
}

/**
 * Converts trusted USD micros from the orders table into Stripe's smallest
 * currency unit. `exchangeRate` is the order's stamped USD→currency rate.
 */
export function stripeMinorUnitsFromUsdMicros(
  micros: number | string | bigint,
  currency: string | null | undefined,
  exchangeRate: number | string | null | undefined,
): number {
  const microsBigInt = typeof micros === "bigint" ? micros : BigInt(Math.max(0, Math.trunc(Number(micros) || 0)));
  if (microsBigInt <= BigInt(0)) return 0;

  const exponent = getStripeCurrencyExponent(currency);
  const rate = decimalToFraction(exchangeRate ?? 1);
  const numerator = microsBigInt * rate.numerator * BigInt(10) ** BigInt(exponent);
  const denominator = BigInt(1_000_000) * rate.denominator;
  const rounded = (numerator + denominator / BigInt(2)) / denominator;
  return Number(rounded);
}

export function normaliseStripeEventType(type: string | null | undefined): string {
  return (type ?? "").trim().replace(/^v1\./, "");
}

export function isStripeCheckoutEventType(type: string | null | undefined): boolean {
  return (STRIPE_SNAPSHOT_EVENT_TYPES as readonly string[]).includes(normaliseStripeEventType(type));
}

export function buildStripeReturnUrls(origin: string, orderId: string): { successUrl: string; cancelUrl: string } {
  const base = origin.replace(/\/+$/, "");
  return {
    successUrl: `${base}/orders/${orderId}?placed=1&stripe=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/orders/${orderId}?stripe=cancelled&session_id={CHECKOUT_SESSION_ID}`,
  };
}

export type StripeCheckoutSessionParamsInput = {
  origin: string;
  orderId: string;
  orderNumber: number | string;
  storeName: string;
  customerEmail?: string | null;
  totalMicros: number;
  currency: string;
  exchangeRate?: number | string | null;
  itemSummary?: string | null;
  imageUrl?: string | null;
  nowSeconds?: number;
};

export function buildStripeCheckoutSessionParams(
  input: StripeCheckoutSessionParamsInput,
): Stripe.Checkout.SessionCreateParams {
  const unitAmount = stripeMinorUnitsFromUsdMicros(input.totalMicros, input.currency, input.exchangeRate);
  if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) {
    throw new Error("Stripe Checkout requires a positive order total.");
  }

  const urls = buildStripeReturnUrls(input.origin, input.orderId);
  const orderNumber = String(input.orderNumber);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const imageUrl = input.imageUrl?.trim();
  let absoluteImageUrl: string | null = null;
  if (imageUrl) {
    try {
      const candidate = new URL(imageUrl, `${input.origin.replace(/\/+$/, "")}/`);
      const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(candidate.hostname);
      // Stripe fetches product images itself. Omit data/blob URLs and local
      // development URLs instead of letting an unusable image fail checkout.
      if (candidate.protocol === "https:" && !isLocalhost) {
        absoluteImageUrl = candidate.toString();
      }
    } catch {
      absoluteImageUrl = null;
    }
  }

  return {
    mode: "payment",
    client_reference_id: input.orderId,
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.trim().toLowerCase(),
          unit_amount: unitAmount,
          product_data: {
            name: `Order #${orderNumber} — ${input.storeName}`.slice(0, 250),
            ...(input.itemSummary ? { description: input.itemSummary.slice(0, 500) } : {}),
            ...(absoluteImageUrl ? { images: [absoluteImageUrl] } : {}),
            metadata: { order_id: input.orderId, order_number: orderNumber },
          },
        },
      },
    ],
    metadata: {
      order_id: input.orderId,
      order_number: orderNumber,
      source: "woo-solution",
    },
    payment_intent_data: {
      metadata: {
        order_id: input.orderId,
        order_number: orderNumber,
        source: "woo-solution",
      },
      ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
    },
    billing_address_collection: "auto",
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    // One hour is long enough to finish paying while keeping abandoned
    // sessions from lingering for Stripe's 24-hour default.
    expires_at: nowSeconds + 60 * 60,
  };
}

type StripeIdLike = string | { id?: string | null } | null | undefined;

export function stripeObjectId(value: StripeIdLike): string | null {
  if (typeof value === "string") return value || null;
  return value?.id ?? null;
}

export type StripeSessionLike = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string | null | undefined> | null;
  payment_intent?: StripeIdLike;
  customer?: StripeIdLike;
};

export type StripeOrderLike = {
  id: string;
  total_micros: number;
  currency: string;
  exchange_rate?: number | string | null;
  stripe_checkout_session_id?: string | null;
};

export type StripeCheckoutEvaluation =
  | {
      outcome: "paid";
      expectedAmount: number;
      paymentIntentId: string | null;
      customerId: string | null;
    }
  | {
      outcome: "pending" | "expired" | "mismatch" | "wrong_order";
      expectedAmount: number;
      paymentIntentId: string | null;
      customerId: string | null;
      reason: string;
    };

/**
 * The fulfilment gate: a redirect or webhook may identify a session, but an
 * order is paid only when the retrieved Stripe session is complete, paid,
 * belongs to this order and matches the trusted DB total/currency exactly.
 */
export function evaluateStripeCheckoutSession(
  session: StripeSessionLike,
  order: StripeOrderLike,
): StripeCheckoutEvaluation {
  const expectedAmount = stripeMinorUnitsFromUsdMicros(
    order.total_micros,
    order.currency,
    order.exchange_rate,
  );
  const paymentIntentId = stripeObjectId(session.payment_intent);
  const customerId = stripeObjectId(session.customer);
  const referencedOrderIds = [session.metadata?.order_id, session.client_reference_id].filter(
    (value): value is string => Boolean(value),
  );

  if (referencedOrderIds.length > 0 && referencedOrderIds.some((id) => id !== order.id)) {
    return {
      outcome: "wrong_order",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe Checkout Session references a different order.",
    };
  }
  if (
    referencedOrderIds.length === 0 &&
    order.stripe_checkout_session_id &&
    order.stripe_checkout_session_id !== session.id
  ) {
    return {
      outcome: "wrong_order",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe Checkout Session does not belong to this order.",
    };
  }

  if (session.status === "expired") {
    return {
      outcome: "expired",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe Checkout Session has expired.",
    };
  }
  if (session.status !== "complete") {
    return {
      outcome: "pending",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe Checkout Session is not complete yet.",
    };
  }
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return {
      outcome: "pending",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "Stripe has not confirmed this payment yet.",
    };
  }

  if ((session.currency ?? "").toLowerCase() !== order.currency.trim().toLowerCase()) {
    return {
      outcome: "mismatch",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe payment currency does not match the order currency.",
    };
  }

  const actualAmount = session.amount_total ?? (expectedAmount === 0 ? 0 : null);
  if (actualAmount !== expectedAmount) {
    return {
      outcome: "mismatch",
      expectedAmount,
      paymentIntentId,
      customerId,
      reason: "The Stripe payment amount does not match the order total.",
    };
  }

  return { outcome: "paid", expectedAmount, paymentIntentId, customerId };
}

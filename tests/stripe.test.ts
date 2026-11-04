import { afterAll, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  buildStripeCheckoutSessionParams,
  buildStripeReturnUrls,
  evaluateStripeCheckoutSession,
  isStripeCheckoutEventType,
  isStripeConfigured,
  isValidStripePublishableKey,
  isValidStripeSecretKey,
  isValidStripeWebhookSecret,
  normaliseStripeEventType,
  stripeKeyMode,
  stripeMinorUnitsFromUsdMicros,
} from "@/lib/stripe";
import { formatOrderNotesWithPayment, parseOrderPaymentInfo } from "@/lib/order-payment";
import { parseStripeWebhookEvent } from "@/lib/stripe.server";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => null,
}));

const ORDER_ID = "00000000-0000-4000-8000-000000000123";
const OTHER_ORDER_ID = "00000000-0000-4000-8000-000000000999";
const TEST_SECRET = "sk_test_1234567890abcdef";
const WEBHOOK_SECRET = "whsec_1234567890abcdef";

const previousEnv = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_ENABLED: process.env.STRIPE_ENABLED,
};
process.env.STRIPE_SECRET_KEY = TEST_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
delete process.env.STRIPE_ENABLED;

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Stripe key handling", () => {
  it("detects test/live mode from publishable, secret and restricted keys", () => {
    expect(stripeKeyMode("pk_test_1234567890")).toBe("test");
    expect(stripeKeyMode("sk_live_1234567890")).toBe("live");
    expect(stripeKeyMode("rk_test_1234567890")).toBe("test");
    expect(stripeKeyMode("whsec_1234567890")).toBeNull();
  });

  it("validates the three credential shapes without accepting a webhook secret as an API key", () => {
    expect(isValidStripePublishableKey("pk_live_1234567890")).toBe(true);
    expect(isValidStripeSecretKey("sk_test_1234567890")).toBe(true);
    expect(isValidStripeSecretKey("rk_live_1234567890")).toBe(true);
    expect(isValidStripeSecretKey(WEBHOOK_SECRET)).toBe(false);
    expect(isValidStripeWebhookSecret(WEBHOOK_SECRET)).toBe(true);
  });

  it("requires the gateway switch plus both server credentials before checkout is offered", () => {
    expect(
      isStripeConfigured({ enabled: true, secretKey: TEST_SECRET, webhookSecret: WEBHOOK_SECRET }),
    ).toBe(true);
    expect(
      isStripeConfigured({ enabled: false, secretKey: TEST_SECRET, webhookSecret: WEBHOOK_SECRET }),
    ).toBe(false);
    expect(isStripeConfigured({ enabled: true, secretKey: TEST_SECRET, webhookSecret: null })).toBe(false);
  });
});

describe("Stripe amount conversion", () => {
  it("converts USD micros to cents with half-up rounding", () => {
    expect(stripeMinorUnitsFromUsdMicros(12_345_678, "USD", 1)).toBe(1235);
    expect(stripeMinorUnitsFromUsdMicros(10_000_000, "usd", "1")).toBe(1000);
  });

  it("uses the order's stamped exchange rate for BDT", () => {
    expect(stripeMinorUnitsFromUsdMicros(10_000_000, "BDT", "120.50")).toBe(120_500);
  });

  it("honours zero- and three-decimal Stripe currencies", () => {
    expect(stripeMinorUnitsFromUsdMicros(10_200_000, "JPY", 150)).toBe(1530);
    expect(stripeMinorUnitsFromUsdMicros(10_000_000, "KWD", "0.31")).toBe(3100);
  });
});

describe("Checkout Session parameters", () => {
  const params = buildStripeCheckoutSessionParams({
    origin: "https://shop.example.com/",
    orderId: ORDER_ID,
    orderNumber: 1042,
    storeName: "Example Store",
    customerEmail: "buyer@example.com",
    totalMicros: 49_990_000,
    currency: "USD",
    exchangeRate: 1,
    itemSummary: "2 × Example product",
    nowSeconds: 1_800_000_000,
  });

  it("creates a one-time hosted payment from the trusted DB total", () => {
    expect(params.mode).toBe("payment");
    expect(params.client_reference_id).toBe(ORDER_ID);
    expect(params.customer_email).toBe("buyer@example.com");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items?.[0]).toMatchObject({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 4999,
        product_data: { name: "Order #1042 — Example Store" },
      },
    });
    expect(params.metadata).toMatchObject({ order_id: ORDER_ID, order_number: "1042" });
    expect(params.payment_intent_data?.metadata).toMatchObject({ order_id: ORDER_ID });
    expect(params.expires_at).toBe(1_800_003_600);
  });

  it("only sends publicly fetchable HTTPS product images to Stripe", () => {
    const withRelativeImage = buildStripeCheckoutSessionParams({
      origin: "https://shop.example.com",
      orderId: ORDER_ID,
      orderNumber: 1042,
      storeName: "Example Store",
      totalMicros: 49_990_000,
      currency: "USD",
      imageUrl: "/products/example.jpg",
      nowSeconds: 1_800_000_000,
    });
    expect(withRelativeImage.line_items?.[0].price_data?.product_data?.images).toEqual([
      "https://shop.example.com/products/example.jpg",
    ]);

    const withDataImage = buildStripeCheckoutSessionParams({
      origin: "https://shop.example.com",
      orderId: ORDER_ID,
      orderNumber: 1042,
      storeName: "Example Store",
      totalMicros: 49_990_000,
      currency: "USD",
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      nowSeconds: 1_800_000_000,
    });
    expect(withDataImage.line_items?.[0].price_data?.product_data?.images).toBeUndefined();
  });

  it("uses Stripe's literal checkout-session placeholder in both return URLs", () => {
    const urls = buildStripeReturnUrls("https://shop.example.com", ORDER_ID);
    expect(urls.successUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(urls.cancelUrl).toContain("stripe=cancelled");
    expect(params.success_url).toBe(urls.successUrl);
    expect(params.cancel_url).toBe(urls.cancelUrl);
  });

  it("posts the expected form-encoded session to Stripe with an idempotency key (mocked HTTP)", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new Stripe(TEST_SECRET, {
      httpClient: Stripe.createFetchHttpClient(async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            id: "cs_test_mocked123",
            object: "checkout.session",
            url: "https://checkout.stripe.com/c/pay/cs_test_mocked123",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
      maxNetworkRetries: 0,
    });

    const session = await client.checkout.sessions.create(params, {
      idempotencyKey: `woo_checkout_${ORDER_ID}_4999_usd_initial`,
    });

    expect(session.id).toBe("cs_test_mocked123");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/v1/checkout/sessions");
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get("idempotency-key")).toContain(ORDER_ID);
    const body = new URLSearchParams(String(requests[0].init?.body ?? ""));
    expect(body.get("mode")).toBe("payment");
    expect(body.get("client_reference_id")).toBe(ORDER_ID);
    expect(body.get("metadata[order_id]")).toBe(ORDER_ID);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("4999");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
  });
});

describe("Stripe fulfilment gate", () => {
  const order = {
    id: ORDER_ID,
    total_micros: 49_990_000,
    currency: "USD",
    exchange_rate: 1,
    stripe_checkout_session_id: "cs_test_paid123",
  };
  const paidSession = {
    id: "cs_test_paid123",
    status: "complete",
    payment_status: "paid",
    amount_total: 4999,
    currency: "usd",
    client_reference_id: ORDER_ID,
    metadata: { order_id: ORDER_ID },
    payment_intent: "pi_test_paid123",
    customer: "cus_test_123",
  };

  it("accepts only a complete, paid session for the exact order amount", () => {
    expect(evaluateStripeCheckoutSession(paidSession, order)).toEqual({
      outcome: "paid",
      expectedAmount: 4999,
      paymentIntentId: "pi_test_paid123",
      customerId: "cus_test_123",
    });
  });

  it("keeps delayed/unpaid sessions pending", () => {
    expect(
      evaluateStripeCheckoutSession({ ...paidSession, payment_status: "unpaid" }, order),
    ).toMatchObject({ outcome: "pending" });
    expect(
      evaluateStripeCheckoutSession({ ...paidSession, status: "open", payment_status: "unpaid" }, order),
    ).toMatchObject({ outcome: "pending" });
  });

  it("rejects wrong amounts, currencies and orders", () => {
    expect(evaluateStripeCheckoutSession({ ...paidSession, amount_total: 4998 }, order)).toMatchObject({
      outcome: "mismatch",
    });
    expect(evaluateStripeCheckoutSession({ ...paidSession, currency: "eur" }, order)).toMatchObject({
      outcome: "mismatch",
    });
    expect(
      evaluateStripeCheckoutSession(
        { ...paidSession, client_reference_id: OTHER_ORDER_ID, metadata: { order_id: OTHER_ORDER_ID } },
        order,
      ),
    ).toMatchObject({ outcome: "wrong_order" });
  });

  it("reports expired sessions separately so a fresh one can be created", () => {
    expect(
      evaluateStripeCheckoutSession(
        { ...paidSession, status: "expired", payment_status: "unpaid" },
        order,
      ),
    ).toMatchObject({ outcome: "expired" });
  });
});

describe("Stripe order labels", () => {
  it("parses dedicated Stripe references and keeps customer notes clean", () => {
    const notes = formatOrderNotesWithPayment("Leave at the door", {
      method: "stripe",
      gateway: "stripe",
      protocolName: "Stripe Checkout",
      stripeCheckoutSessionId: "cs_test_label123",
      stripePaymentIntentId: "pi_test_label123",
    });
    const parsed = parseOrderPaymentInfo({
      payment_method: "stripe",
      notes,
      payment_protocol: "Stripe Checkout",
      payment_network: "Test mode",
      payment_address: null,
      payment_tx_id: "pi_test_label123",
      stripe_checkout_session_id: "cs_test_label123",
      stripe_payment_intent_id: "pi_test_label123",
    });

    expect(parsed).toMatchObject({
      isStripe: true,
      isCrypto: false,
      methodLabel: "Stripe Checkout (Test mode)",
      shortMethodLabel: "STRIPE [TEST]",
      stripeCheckoutSessionId: "cs_test_label123",
      stripePaymentIntentId: "pi_test_label123",
      customerNotes: "Leave at the door",
    });
  });
});

describe("Stripe webhook signature parsing", () => {
  it("normalises thin and snapshot checkout event names", () => {
    expect(normaliseStripeEventType("v1.checkout.session.completed")).toBe(
      "checkout.session.completed",
    );
    expect(isStripeCheckoutEventType("v1.checkout.session.async_payment_succeeded")).toBe(true);
    expect(isStripeCheckoutEventType("payment_intent.succeeded")).toBe(false);
  });

  it("verifies and parses a snapshot event signed with the endpoint secret", async () => {
    const payload = JSON.stringify({
      id: "evt_test_snapshot123",
      object: "event",
      api_version: "2026-10-28.endive",
      created: 1_800_000_000,
      livemode: false,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_snapshot123",
          object: "checkout.session",
          status: "complete",
          payment_status: "paid",
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    await expect(parseStripeWebhookEvent(payload, signature)).resolves.toMatchObject({
      eventId: "evt_test_snapshot123",
      eventType: "checkout.session.completed",
      normalisedType: "checkout.session.completed",
      sessionId: "cs_test_snapshot123",
      format: "snapshot",
    });
    await expect(
      parseStripeWebhookEvent(payload.replace("cs_test_snapshot123", "cs_test_tampered123"), signature),
    ).rejects.toThrow();
  });

  it("verifies and parses a thin v1 checkout event notification", async () => {
    const payload = JSON.stringify({
      id: "evt_test_thin123",
      object: "v2.core.event",
      type: "v1.checkout.session.completed",
      livemode: false,
      created: "2027-01-15T00:00:00.000Z",
      related_object: {
        id: "cs_test_thin123",
        type: "checkout.session",
        url: "/v1/checkout/sessions/cs_test_thin123",
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    await expect(parseStripeWebhookEvent(payload, signature)).resolves.toMatchObject({
      eventId: "evt_test_thin123",
      eventType: "v1.checkout.session.completed",
      normalisedType: "checkout.session.completed",
      sessionId: "cs_test_thin123",
      format: "thin",
    });
  });
});

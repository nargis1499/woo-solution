import "server-only";

import Stripe from "stripe";
import { publishNotificationsChanged } from "@/lib/notification-bus";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import {
  buildStripeCheckoutSessionParams,
  evaluateStripeCheckoutSession,
  isStripeConfigured,
  isValidStripeSecretKey,
  normaliseStripeEventType,
  stripeKeyMode,
  stripeMinorUnitsFromUsdMicros,
  stripeObjectId,
  stripeSecretLast4,
  type StripeAdminSummary,
  type StripeCredentialSource,
  type StripeKeyMode,
  type StripeSessionLike,
} from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StripeSettingsRow = {
  enabled: boolean;
  publishable_key: string | null;
  secret_key: string | null;
  webhook_secret: string | null;
};

export type StripeConfig = {
  enabled: boolean;
  publishableKey: string | null;
  secretKey: string | null;
  secretSource: StripeCredentialSource;
  webhookSecret: string | null;
  webhookSource: StripeCredentialSource;
  /** Raw environment fallbacks, kept server-only for save validation. */
  environmentSecretKey: string | null;
  environmentWebhookSecret: string | null;
  mode: StripeKeyMode | null;
  configured: boolean;
  migrated: boolean;
  serviceRoleConfigured: boolean;
};

type StripeOrderItemRow = {
  product_name: string;
  quantity: number;
  image_url: string | null;
};

type StripeOrderRow = {
  id: string;
  order_number: number;
  user_id: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  currency: string;
  exchange_rate: number | string | null;
  total_micros: number;
  customer_email: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  stripe_checkout_status: string | null;
  stripe_payment_status: string | null;
  order_items?: StripeOrderItemRow[] | null;
};

const STRIPE_ORDER_COLUMNS =
  "id, order_number, user_id, status, payment_method, payment_status, currency, exchange_rate, total_micros, customer_email, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_checkout_status, stripe_payment_status, order_items(product_name, quantity, image_url)";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMissingStripeSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  return /42P01|42703|PGRST205|stripe_(settings|webhook_events|checkout|payment|customer)/i.test(text);
}

function stripeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const maybeStripe = error as Error & { type?: string; code?: string };
    if (maybeStripe.type?.startsWith("Stripe") || maybeStripe.code) {
      return error.message.slice(0, 300) || fallback;
    }
    if (/stripe_/i.test(error.message) && /does not exist|schema cache|column/i.test(error.message)) {
      return "Stripe database migration 20261063000000_stripe_checkout.sql has not been run yet.";
    }
  }
  return fallback;
}

export async function getStripeConfig(): Promise<StripeConfig> {
  const service = createServiceClient();
  const serviceRoleConfigured = Boolean(service);
  let row: StripeSettingsRow | null = null;
  let migrated = false;

  if (service) {
    const result = await service
      .from("stripe_settings")
      .select("enabled, publishable_key, secret_key, webhook_secret")
      .eq("id", 1)
      .maybeSingle();
    if (!result.error) {
      migrated = true;
      row = (result.data as StripeSettingsRow | null) ?? null;
    } else {
      migrated = !isMissingStripeSchema(result.error);
    }
  }

  const envSecret = clean(process.env.STRIPE_SECRET_KEY);
  const envWebhook = clean(process.env.STRIPE_WEBHOOK_SECRET);
  const envPublishable = clean(
    process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );

  const secretKey = clean(row?.secret_key) ?? envSecret;
  const webhookSecret = clean(row?.webhook_secret) ?? envWebhook;
  const publishableKey = clean(row?.publishable_key) ?? envPublishable;
  const enabled =
    row?.enabled ??
    (process.env.STRIPE_ENABLED !== undefined
      ? process.env.STRIPE_ENABLED.toLowerCase() === "true"
      : Boolean(envSecret && envWebhook));

  return {
    enabled,
    publishableKey,
    secretKey,
    secretSource: clean(row?.secret_key) ? "database" : envSecret ? "environment" : null,
    webhookSecret,
    webhookSource: clean(row?.webhook_secret) ? "database" : envWebhook ? "environment" : null,
    environmentSecretKey: envSecret,
    environmentWebhookSecret: envWebhook,
    mode: stripeKeyMode(secretKey) ?? stripeKeyMode(publishableKey),
    configured: isStripeConfigured({ enabled, secretKey, webhookSecret }),
    migrated,
    serviceRoleConfigured,
  };
}

export async function getStripeAdminSummary(): Promise<StripeAdminSummary> {
  const config = await getStripeConfig();
  return {
    enabled: config.enabled,
    publishableKey: config.publishableKey,
    hasSecretKey: Boolean(config.secretKey),
    secretKeyLast4: stripeSecretLast4(config.secretKey),
    secretSource: config.secretSource,
    hasWebhookSecret: Boolean(config.webhookSecret),
    webhookSecretLast4: stripeSecretLast4(config.webhookSecret),
    webhookSource: config.webhookSource,
    mode: config.mode,
    configured: config.configured,
    migrated: config.migrated,
    serviceRoleConfigured: config.serviceRoleConfigured,
  };
}

export async function saveStripeSettingsRecord(input: {
  enabled: boolean;
  publishableKey: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = createServiceClient();
  if (!service) {
    return {
      ok: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so Stripe secrets cannot be stored securely.",
    };
  }

  const { error } = await service.from("stripe_settings").upsert(
    {
      id: 1,
      enabled: input.enabled,
      publishable_key: input.publishableKey,
      secret_key: input.secretKey,
      webhook_secret: input.webhookSecret,
    },
    { onConflict: "id" },
  );
  if (error) {
    return {
      ok: false,
      error: isMissingStripeSchema(error)
        ? "Run supabase/migrations/20261063000000_stripe_checkout.sql in Supabase first."
        : `Could not save Stripe settings: ${error.message}`,
    };
  }
  return { ok: true };
}

export async function getStripePaymentAvailability(): Promise<{
  enabled: boolean;
  mode: StripeKeyMode | null;
}> {
  const config = await getStripeConfig();
  // Don't advertise a gateway that cannot persist sessions or reconcile
  // webhooks. Those operations require both the migration and service role.
  return {
    enabled: config.configured && config.migrated && config.serviceRoleConfigured,
    mode: config.mode,
  };
}

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    // Fetch + Web Crypto are the portable choices for both Node.js and
    // Cloudflare Workers/OpenNext. The SDK sends its bundled API version.
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
    maxNetworkRetries: 1,
    timeout: 20_000,
    appInfo: { name: "Woo Solution", version: "1.0.0" },
  });
}

export async function testStripeSecretKey(
  secretKey: string,
): Promise<{ ok: true; mode: StripeKeyMode | null } | { ok: false; error: string }> {
  if (!isValidStripeSecretKey(secretKey)) {
    return { ok: false, error: "Enter a valid Stripe secret or restricted key (sk_… or rk_…)." };
  }
  try {
    const stripe = createStripeClient(secretKey);
    // Confirms both authentication and access to the resource this integration uses.
    await stripe.checkout.sessions.list({ limit: 1 });
    return { ok: true, mode: stripeKeyMode(secretKey) };
  } catch (error) {
    return {
      ok: false,
      error: stripeErrorMessage(
        error,
        "Stripe rejected this key. Check that it belongs to the right account/mode and has Checkout Sessions access if it is a restricted key.",
      ),
    };
  }
}

export function resolveStripeSiteOrigin(input: {
  originHeader?: string | null;
  configuredSiteUrl?: string | null;
}): string {
  const candidates = [
    input.originHeader,
    input.configuredSiteUrl,
    process.env.NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Try the next candidate.
    }
  }
  return "http://localhost:3000";
}

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

async function getStripeOrder(service: ServiceClient, orderId: string): Promise<StripeOrderRow | null> {
  const { data, error } = await service
    .from("orders")
    .select(STRIPE_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StripeOrderRow | null) ?? null;
}

async function getStripeOrderBySessionId(
  service: ServiceClient,
  sessionId: string,
): Promise<StripeOrderRow | null> {
  const { data, error } = await service
    .from("orders")
    .select(STRIPE_ORDER_COLUMNS)
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StripeOrderRow | null) ?? null;
}

async function updateStripeOrder(
  service: ServiceClient,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.from("orders").update(patch).eq("id", orderId);
  if (error) throw new Error(error.message);
}

function orderItemSummary(order: StripeOrderRow): string | null {
  const items = order.order_items ?? [];
  if (items.length === 0) return null;
  return items.map((item) => `${item.quantity} × ${item.product_name}`).join(", ").slice(0, 500);
}

function sessionModeLabel(session: { livemode?: boolean } | null, fallback: StripeKeyMode | null): string {
  if (typeof session?.livemode === "boolean") return session.livemode ? "Live mode" : "Test mode";
  return fallback === "live" ? "Live mode" : "Test mode";
}

export type CreateStripeCheckoutResult =
  | { ok: true; status: "redirect"; url: string; sessionId: string }
  | { ok: true; status: "paid" | "pending"; sessionId: string | null }
  | { ok: false; error: string };

export async function createStripeCheckoutSessionForOrder(input: {
  orderId: string;
  siteOrigin: string;
  expectedUserId?: string | null;
}): Promise<CreateStripeCheckoutResult> {
  if (!UUID_RE.test(input.orderId)) return { ok: false, error: "Unknown order." };

  const config = await getStripeConfig();
  if (!config.configured || !config.secretKey) {
    return {
      ok: false,
      error: "Stripe Checkout is not fully configured. Ask the store admin to finish E-commerce → Payment → Stripe Checkout.",
    };
  }
  const service = createServiceClient();
  if (!service) {
    return { ok: false, error: "Stripe Checkout is unavailable because the server service key is not configured." };
  }

  try {
    const order = await getStripeOrder(service, input.orderId);
    if (!order || (input.expectedUserId && order.user_id !== input.expectedUserId)) {
      return { ok: false, error: "Unknown order." };
    }
    if (order.status === "cancelled") {
      return { ok: false, error: "This order was cancelled, so it can no longer be paid." };
    }
    if (order.payment_status === "refunded") {
      return { ok: false, error: "This order was refunded, so it can no longer be paid." };
    }
    if (order.payment_status === "paid") {
      return { ok: true, status: "paid", sessionId: order.stripe_checkout_session_id };
    }

    const basePatch = {
      payment_method: "stripe",
      payment_protocol: "Stripe Checkout",
      payment_network: config.mode === "live" ? "Live mode" : "Test mode",
    };
    await updateStripeOrder(service, order.id, basePatch);

    const expectedAmount = stripeMinorUnitsFromUsdMicros(
      order.total_micros,
      order.currency,
      order.exchange_rate,
    );
    if (expectedAmount <= 0) {
      await updateStripeOrder(service, order.id, {
        ...basePatch,
        payment_status: "paid",
        ...(order.status === "pending" ? { status: "processing" } : {}),
        stripe_checkout_status: "complete",
        stripe_payment_status: "no_payment_required",
      });
      if (order.user_id) publishNotificationsChanged(order.user_id);
      return { ok: true, status: "paid", sessionId: order.stripe_checkout_session_id };
    }

    const stripe = createStripeClient(config.secretKey);
    let previousSessionId: string | null = order.stripe_checkout_session_id;

    if (previousSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(previousSessionId);
        const applied = await applyStripeSessionToOrder({
          service,
          session: existing,
          expectedOrderId: order.id,
          expectedUserId: input.expectedUserId,
          mode: config.mode,
        });
        if (applied.status === "paid") {
          return { ok: true, status: "paid", sessionId: existing.id };
        }
        if (!applied.ok) {
          return { ok: false, error: applied.error };
        }
        if (applied.status === "ignored") {
          return {
            ok: false,
            error: "The saved Stripe Checkout Session does not match this order. Please contact the store.",
          };
        }
        if (existing.status === "open" && existing.url) {
          return { ok: true, status: "redirect", url: existing.url, sessionId: existing.id };
        }
        if (existing.status === "complete" && order.stripe_payment_status !== "failed") {
          // A delayed payment method can still settle; never create a second
          // payable session while Stripe says this one is complete/unpaid.
          return { ok: true, status: "pending", sessionId: existing.id };
        }
        previousSessionId = existing.id;
      } catch {
        // A session created under an old test/live key may not exist under
        // the current key. Creating below will surface any real auth error.
      }
    }

    const settings = await getSiteSettingsFresh();
    const params = buildStripeCheckoutSessionParams({
      origin: input.siteOrigin,
      orderId: order.id,
      orderNumber: order.order_number,
      storeName: settings.store_name || "Woo Solution",
      customerEmail: order.customer_email,
      totalMicros: order.total_micros,
      currency: order.currency,
      exchangeRate: order.exchange_rate,
      itemSummary: orderItemSummary(order),
      imageUrl: order.order_items?.find((item) => item.image_url)?.image_url ?? null,
      // Stripe idempotency keys must be reused with identical parameters.
      // Bucket the expiry so concurrent/retried calls in the same five
      // minutes build exactly the same session request.
      nowSeconds: Math.floor(Date.now() / 1000 / 300) * 300,
    });
    const idempotencyKey = [
      "woo_checkout",
      order.id,
      expectedAmount,
      order.currency.toLowerCase(),
      params.expires_at ?? "noexpiry",
      previousSessionId ?? "initial",
    ]
      .join("_")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 240);

    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
    if (!session.url) {
      return { ok: false, error: "Stripe did not return a Checkout URL. Please try again." };
    }

    await updateStripeOrder(service, order.id, {
      ...basePatch,
      payment_tx_id: stripeObjectId(session.payment_intent),
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: stripeObjectId(session.payment_intent),
      stripe_customer_id: stripeObjectId(session.customer),
      stripe_checkout_status: session.status,
      stripe_payment_status: session.payment_status,
    });

    return { ok: true, status: "redirect", url: session.url, sessionId: session.id };
  } catch (error) {
    return {
      ok: false,
      error: stripeErrorMessage(error, "Could not start Stripe Checkout. Please try again."),
    };
  }
}

export type ApplyStripeSessionResult =
  | { ok: true; status: "paid" | "pending" | "expired" | "failed"; orderId: string }
  | { ok: true; status: "ignored"; orderId: string | null; reason: string }
  | { ok: false; status: "error"; orderId: string | null; error: string };

async function applyStripeSessionToOrder(input: {
  service: ServiceClient;
  session: Stripe.Checkout.Session;
  expectedOrderId?: string | null;
  expectedUserId?: string | null;
  eventType?: string | null;
  mode?: StripeKeyMode | null;
}): Promise<ApplyStripeSessionResult> {
  const session = input.session as StripeSessionLike & { livemode?: boolean };
  const referencedOrderId =
    clean(session.metadata?.order_id) ?? clean(session.client_reference_id) ?? input.expectedOrderId ?? null;

  try {
    let order: StripeOrderRow | null = null;
    if (referencedOrderId && UUID_RE.test(referencedOrderId)) {
      order = await getStripeOrder(input.service, referencedOrderId);
    }
    if (!order) order = await getStripeOrderBySessionId(input.service, session.id);
    if (!order) {
      return {
        ok: true,
        status: "ignored",
        orderId: referencedOrderId,
        reason: "No matching order exists for this Stripe Checkout Session.",
      };
    }
    if (input.expectedOrderId && order.id !== input.expectedOrderId) {
      return {
        ok: true,
        status: "ignored",
        orderId: order.id,
        reason: "The Stripe Checkout Session belongs to a different order.",
      };
    }
    if (input.expectedUserId && order.user_id !== input.expectedUserId) {
      return {
        ok: true,
        status: "ignored",
        orderId: order.id,
        reason: "The Stripe Checkout Session belongs to a different customer.",
      };
    }

    const evaluation = evaluateStripeCheckoutSession(session, order);
    const eventType = normaliseStripeEventType(input.eventType);
    const failed = eventType === "checkout.session.async_payment_failed";

    if (evaluation.outcome === "mismatch" || evaluation.outcome === "wrong_order") {
      console.error("[stripe] Refused to fulfil mismatched Checkout Session", {
        orderId: order.id,
        sessionId: session.id,
        reason: evaluation.reason,
      });
      return { ok: true, status: "ignored", orderId: order.id, reason: evaluation.reason };
    }

    // A Checkout Session remains payment_status=paid after a Dashboard
    // refund. Never let a late/replayed session sync erase the local
    // terminal refunded state or move the order back into fulfilment.
    if (order.payment_status === "refunded") {
      return {
        ok: true,
        status: "ignored",
        orderId: order.id,
        reason: "The order is already refunded; the Stripe session was not reapplied.",
      };
    }

    const alreadyPaid = order.payment_status === "paid";
    const patch: Record<string, unknown> = {
      payment_method: "stripe",
      payment_protocol: "Stripe Checkout",
      payment_network: sessionModeLabel(session, input.mode ?? null),
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: evaluation.paymentIntentId ?? order.stripe_payment_intent_id,
      stripe_customer_id: evaluation.customerId ?? order.stripe_customer_id,
      stripe_checkout_status: session.status ?? null,
      stripe_payment_status: failed ? "failed" : (session.payment_status ?? null),
    };
    if (evaluation.paymentIntentId) patch.payment_tx_id = evaluation.paymentIntentId;

    if (evaluation.outcome === "paid") {
      patch.payment_status = "paid";
      if (order.status === "pending") patch.status = "processing";
    }

    await updateStripeOrder(input.service, order.id, patch);

    if (evaluation.outcome === "paid") {
      if (!alreadyPaid && order.user_id) publishNotificationsChanged(order.user_id);
      return { ok: true, status: "paid", orderId: order.id };
    }
    if (failed) return { ok: true, status: "failed", orderId: order.id };
    if (evaluation.outcome === "expired") return { ok: true, status: "expired", orderId: order.id };
    return { ok: true, status: "pending", orderId: order.id };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      orderId: referencedOrderId,
      error: stripeErrorMessage(error, "Could not reconcile the Stripe payment with this order."),
    };
  }
}

/**
 * Retrieves a session directly from Stripe and applies it. Used by both the
 * signed webhook and the customer's success return; neither path trusts a
 * browser-supplied payment result.
 */
export async function syncStripeCheckoutSession(
  sessionId: string,
  options: {
    expectedOrderId?: string | null;
    expectedUserId?: string | null;
    eventType?: string | null;
  } = {},
): Promise<ApplyStripeSessionResult> {
  if (!/^cs_(?:test|live)_[A-Za-z0-9_-]+$/.test(sessionId) && !/^cs_[A-Za-z0-9_-]+$/.test(sessionId)) {
    return { ok: false, status: "error", orderId: options.expectedOrderId ?? null, error: "Invalid Stripe Checkout Session ID." };
  }
  const config = await getStripeConfig();
  if (!config.secretKey) {
    return { ok: false, status: "error", orderId: options.expectedOrderId ?? null, error: "Stripe is not configured." };
  }
  const service = createServiceClient();
  if (!service) {
    return {
      ok: false,
      status: "error",
      orderId: options.expectedOrderId ?? null,
      error: "The server service key is not configured.",
    };
  }

  try {
    const stripe = createStripeClient(config.secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return applyStripeSessionToOrder({
      service,
      session,
      expectedOrderId: options.expectedOrderId,
      expectedUserId: options.expectedUserId,
      eventType: options.eventType,
      mode: config.mode,
    });
  } catch (error) {
    return {
      ok: false,
      status: "error",
      orderId: options.expectedOrderId ?? null,
      error: stripeErrorMessage(error, "Could not retrieve this Stripe Checkout Session."),
    };
  }
}

export type ParsedStripeWebhookEvent = {
  eventId: string;
  eventType: string;
  normalisedType: string;
  sessionId: string | null;
  format: "thin" | "snapshot";
};

export async function parseStripeWebhookEvent(
  payload: string,
  signature: string,
): Promise<ParsedStripeWebhookEvent> {
  const config = await getStripeConfig();
  if (!config.secretKey || !config.webhookSecret) {
    throw new Error("Stripe webhook is not configured.");
  }
  const stripe = createStripeClient(config.secretKey);
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  let declaredType = "";
  let declaredObject = "";
  let hasRelatedObject = false;
  try {
    const parsed = JSON.parse(payload) as {
      type?: unknown;
      object?: unknown;
      related_object?: unknown;
      relatedObject?: unknown;
    };
    declaredType = String(parsed.type ?? "");
    declaredObject = String(parsed.object ?? "");
    hasRelatedObject = Boolean(parsed.related_object ?? parsed.relatedObject);
  } catch {
    // Stripe's verifier below returns the proper invalid-payload error.
  }

  // The unverified envelope is used only to select Stripe's verifier. It is
  // never trusted for fulfilment; both branches verify Stripe-Signature.
  const looksThin =
    /^v[12]\./.test(declaredType) || /^v2\./.test(declaredObject) || hasRelatedObject;
  if (looksThin) {
    const notification = await stripe.parseEventNotificationAsync(
      payload,
      signature,
      config.webhookSecret,
      undefined,
      cryptoProvider,
    );
    const notificationLike = notification as {
      related_object?: { id?: string } | null;
      relatedObject?: { id?: string } | null;
    };
    const related = notificationLike.related_object ?? notificationLike.relatedObject;
    return {
      eventId: notification.id,
      eventType: notification.type,
      normalisedType: normaliseStripeEventType(notification.type),
      sessionId: related?.id ?? null,
      format: "thin",
    };
  }

  const event = await stripe.webhooks.constructEventAsync(
    payload,
    signature,
    config.webhookSecret,
    undefined,
    cryptoProvider,
  );
  const object = event.data.object as { id?: string };
  return {
    eventId: event.id,
    eventType: event.type,
    normalisedType: normaliseStripeEventType(event.type),
    sessionId: object?.id ?? null,
    format: "snapshot",
  };
}

export async function claimStripeWebhookEvent(event: ParsedStripeWebhookEvent): Promise<
  | { claimed: true }
  | { claimed: false; duplicate: true }
> {
  const service = createServiceClient();
  if (!service) throw new Error("The server service key is not configured.");

  const inserted = await service.from("stripe_webhook_events").insert({
    event_id: event.eventId,
    event_type: event.eventType,
    checkout_session_id: event.sessionId,
    status: "processing",
  });
  if (!inserted.error) return { claimed: true };
  if (isMissingStripeSchema(inserted.error)) {
    // Order/session fulfilment below is still idempotent if an older DB has
    // the order columns but not this optional ledger table.
    return { claimed: true };
  }
  if (inserted.error.code !== "23505") throw new Error(inserted.error.message);

  const { data, error } = await service
    .from("stripe_webhook_events")
    .select("status, updated_at")
    .eq("event_id", event.eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { status?: string; updated_at?: string } | null;
  if (row?.status === "processed") return { claimed: false, duplicate: true };

  const updatedAt = row?.updated_at ? Date.parse(row.updated_at) : 0;
  const stale = !Number.isFinite(updatedAt) || Date.now() - updatedAt > 2 * 60 * 1000;
  if (row?.status === "failed" || stale) {
    const retry = await service
      .from("stripe_webhook_events")
      .update({ status: "processing", error: null, checkout_session_id: event.sessionId })
      .eq("event_id", event.eventId);
    if (retry.error) throw new Error(retry.error.message);
    return { claimed: true };
  }
  return { claimed: false, duplicate: true };
}

export async function completeStripeWebhookEvent(input: {
  eventId: string;
  orderId?: string | null;
  error?: string | null;
  note?: string | null;
}): Promise<void> {
  const service = createServiceClient();
  if (!service) return;
  await service
    .from("stripe_webhook_events")
    .update({
      status: input.error ? "failed" : "processed",
      order_id: input.orderId && UUID_RE.test(input.orderId) ? input.orderId : null,
      error: (input.error ?? input.note)?.slice(0, 1000) ?? null,
      processed_at: input.error ? null : new Date().toISOString(),
    })
    .eq("event_id", input.eventId);
}

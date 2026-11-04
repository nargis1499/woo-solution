"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  formatOrderNotesWithPayment,
  parseOrderPaymentInfo,
  type OrderPaymentInput,
} from "@/lib/order-payment";
import { resolvePlisioCurrency, type PlisioInvoiceSession } from "@/lib/plisio";
import { createPlisioOrderInvoice } from "@/lib/plisio.server";
import {
  createStripeCheckoutSessionForOrder,
  getStripePaymentAvailability,
  resolveStripeSiteOrigin,
} from "@/lib/stripe.server";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isMissingCouponCheckout,
  isMissingCouponsSchema,
  normalizeCouponCode,
  percentOffNumber,
  type AppliedCoupon,
} from "@/lib/coupons";
import type { ShippingInput } from "@/lib/types";

export type PlaceOrderInput = {
  items: { product_id: string; variation_id?: string | null; quantity: number }[];
  shipping: ShippingInput;
  payment?: OrderPaymentInput;
  /** Promo code to redeem (migration 20261061). `place_order()` re-validates it server-side. */
  couponCode?: string | null;
};

export type CouponPreviewResult =
  | { ok: true; coupon: AppliedCoupon; subtotalMicros: number; shippingMicros: number; totalMicros: number }
  | { ok: false; error: string };

export type PlaceOrderResult =
  | {
      ok: true;
      orderId: string;
      plisioInvoice?: PlisioInvoiceSession;
      stripeCheckoutUrl?: string;
      stripeCheckoutError?: string;
      stripePaymentStatus?: "paid" | "pending";
    }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type CartLineInput = { product_id: string; variation_id: string | null; quantity: number };

/** The same line shaping the order itself uses – shared with the coupon preview. */
function shapeItems(input: unknown): CartLineInput[] {
  return Array.isArray(input)
    ? input
        .filter((i) => i && UUID_RE.test(String((i as { product_id?: unknown }).product_id)))
        .map((i) => {
          const line = i as { product_id: unknown; variation_id?: unknown; quantity?: unknown };
          return {
            product_id: String(line.product_id),
            variation_id:
              line.variation_id && UUID_RE.test(String(line.variation_id)) ? String(line.variation_id) : null,
            quantity: Math.floor(Number(line.quantity)),
          };
        })
        .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0)
        .slice(0, 100)
    : [];
}

/**
 * Prices a promo code against the current cart (no order is placed).
 * Everything is recomputed from the database by `preview_coupon()`.
 */
export async function previewCoupon(input: {
  code: string;
  items: { product_id: string; variation_id?: string | null; quantity: number }[];
}): Promise<CouponPreviewResult> {
  const code = normalizeCouponCode(clean(input?.code, 40));
  if (!code) return { ok: false, error: "Enter a coupon code." };
  const items = shapeItems(input?.items);
  if (items.length === 0) return { ok: false, error: "Your cart is empty." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_coupon", { p_code: code, p_items: items });
  if (error) {
    if (isMissingCouponsSchema(error) || isMissingCouponCheckout(error)) {
      return { ok: false, error: "Coupons aren't available right now." };
    }
    return { ok: false, error: "We couldn't check that coupon. Please try again." };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok !== true) {
    return { ok: false, error: typeof result.message === "string" ? result.message : "That coupon code is not valid." };
  }

  const micros = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0)) || 0);
  return {
    ok: true,
    coupon: {
      code: typeof result.code === "string" ? result.code : code,
      description: typeof result.description === "string" ? result.description : null,
      discountMicros: micros(result.discount_micros),
      freeShipping: result.free_shipping === true,
      discountType: result.discount_type === "fixed" ? "fixed" : "percent",
      percentOff: percentOffNumber(result.percent_off as number | string | null),
      expiresAt: typeof result.expires_at === "string" ? result.expires_at : null,
    },
    subtotalMicros: micros(result.subtotal_micros),
    shippingMicros: micros(result.shipping_micros),
    totalMicros: micros(result.total_micros),
  };
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  // ── validate payload shape (the DB function validates business rules) ──
  const items = shapeItems(input?.items);
  const couponCode = input?.couponCode ? normalizeCouponCode(clean(input.couponCode, 40)) || null : null;

  if (items.length === 0) return { ok: false, error: "Your cart is empty." };

  const rawMethod = input.payment?.method;
  const paymentMethod: "cod" | "crypto" | "plisio" | "stripe" =
    rawMethod === "stripe"
      ? "stripe"
      : rawMethod === "plisio"
        ? "plisio"
        : rawMethod === "crypto"
          ? "crypto"
          : "cod";

  const paymentTxId = clean(input.payment?.transactionId, 240);
  if (paymentMethod === "crypto" && !paymentTxId) {
    return {
      ok: false,
      error: "Please enter your Transaction ID (TXID) so the Admin can verify your payment.",
    };
  }

  if (paymentMethod === "stripe") {
    const stripe = await getStripePaymentAvailability();
    if (!stripe.enabled) {
      return {
        ok: false,
        error: "Stripe Checkout is not available right now. Please choose another payment method.",
      };
    }
  }

  let plisioCurrency = null;
  if (paymentMethod === "plisio") {
    const settings = await getSiteSettingsFresh();
    plisioCurrency = resolvePlisioCurrency(
      settings.payment_plisio_currencies,
      clean(input.payment?.plisioCid || input.payment?.protocolCode, 40) || "USDT_TRX",
    );
  }

  const normalizedPayment: OrderPaymentInput | undefined =
    paymentMethod === "plisio" && plisioCurrency
      ? {
          method: "plisio",
          gateway: "plisio",
          protocolCode: plisioCurrency.code,
          protocolName: `${plisioCurrency.name} · Plisio`,
          network: plisioCurrency.network,
          plisioCid: plisioCurrency.cid,
        }
      : paymentMethod === "crypto"
        ? {
            method: "crypto",
            gateway: "manual",
            protocolCode: clean(input.payment?.protocolCode, 40),
            protocolName: clean(input.payment?.protocolName, 80),
            network: clean(input.payment?.network, 80),
            depositAddress: clean(input.payment?.depositAddress, 200),
            transactionId: paymentTxId,
          }
        : paymentMethod === "stripe"
          ? {
              method: "stripe",
              gateway: "stripe",
              protocolCode: "stripe",
              protocolName: "Stripe Checkout",
            }
          : { method: "cod" };

  const rawCustomerNotes = clean(input.shipping?.notes, 600);
  const notesWithPayment = formatOrderNotesWithPayment(rawCustomerNotes, normalizedPayment);

  const shipping = {
    name: clean(input.shipping?.name, 120),
    phone: clean(input.shipping?.phone, 40),
    address_line1: clean(input.shipping?.address_line1),
    address_line2: clean(input.shipping?.address_line2),
    city: clean(input.shipping?.city, 100),
    postal_code: clean(input.shipping?.postal_code, 20),
    country: clean(input.shipping?.country, 100),
    notes: clean(notesWithPayment, 1000),
  };

  if (!shipping.name || !shipping.address_line1 || !shipping.city || !shipping.country) {
    return { ok: false, error: "Please fill in all required shipping fields." };
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { ok: false, error: "Please sign in to place your order." };
  }

  let { data, error } = await supabase.rpc("place_order", {
    p_items: items,
    p_shipping: shipping,
    p_coupon_code: couponCode,
  });

  // A database that has not run migration 20261061 yet only knows the
  // 2-argument place_order. Orders without a coupon keep working there;
  // with one we must fail loudly instead of silently charging full price.
  if (error && isMissingCouponCheckout(error)) {
    if (couponCode) {
      return { ok: false, error: "Coupons aren't available right now. Please remove the coupon and try again." };
    }
    ({ data, error } = await supabase.rpc("place_order", {
      p_items: items,
      p_shipping: shipping,
    }));
  }

  if (error) {
    // `raise exception` messages from place_order are user-friendly already
    return { ok: false, error: error.message || "We couldn't place your order. Please try again." };
  }

  const orderId = String(data);
  const totalQty = items.reduce((sum, i) => sum + Math.max(1, i.quantity), 0);

  try {
    const service = createServiceClient();
    if (service) {
      // 1. Stamp structured payment fields on the order row when using manual Crypto
      if (paymentMethod === "crypto" && normalizedPayment) {
        const methodDisplay = normalizedPayment.protocolCode
          ? `crypto (${normalizedPayment.protocolCode})`
          : "crypto";
        const fullUpdate = await service
          .from("orders")
          .update({
            payment_method: methodDisplay,
            payment_protocol:
              normalizedPayment.protocolName || normalizedPayment.protocolCode || null,
            payment_network: normalizedPayment.network || null,
            payment_address: normalizedPayment.depositAddress || null,
            payment_tx_id: normalizedPayment.transactionId || null,
          })
          .eq("id", orderId);

        if (fullUpdate.error) {
          await service
            .from("orders")
            .update({ payment_method: methodDisplay })
            .eq("id", orderId);
        }
      }

      // 2. Ensure `new_order` notifications in the DB have the real item count
      // (since `after insert on public.orders` fires before `order_items` are inserted)
      if (totalQty > 0) {
        const { data: notifRows } = await service
          .from("notifications")
          .select("id, recipient_id, kind, title, body, href, order_id, actor_name, read_at, created_at")
          .eq("order_id", orderId)
          .eq("kind", "new_order");

        const staleRows = (notifRows ?? []).filter((r) =>
          /\b0 items\b/i.test(String(r.body ?? "")),
        );
        if (staleRows.length > 0) {
          const itemWord = totalQty === 1 ? "item" : "items";
          const ids = staleRows.map((r) => String(r.id));
          await service.from("notifications").delete().in("id", ids);
          await service.from("notifications").insert(
            staleRows.map((r) => ({
              id: r.id,
              recipient_id: r.recipient_id,
              kind: r.kind,
              title: r.title,
              body: String(r.body).replace(/\b0 items\b/i, `${totalQty} ${itemWord}`),
              href: r.href,
              order_id: r.order_id,
              actor_name: r.actor_name,
              read_at: r.read_at,
              created_at: r.created_at,
            })),
          );
        }
      }
    }
  } catch {
    // Non-fatal: `enrichNewOrderNotifications` also resolves item counts at read time
  }

  // 3. Stripe: create the hosted Checkout Session from the trusted order row
  // that place_order() just priced in the database. If Stripe is temporarily
  // unreachable, keep the order and send the customer to its Pay-now retry
  // instead of making them place a duplicate order.
  if (paymentMethod === "stripe") {
    const [h, settings] = await Promise.all([headers(), getSiteSettingsFresh()]);
    const userId =
      typeof (claims.claims as { sub?: unknown }).sub === "string"
        ? (claims.claims as { sub: string }).sub
        : null;
    const stripeResult = await createStripeCheckoutSessionForOrder({
      orderId,
      siteOrigin: resolveStripeSiteOrigin({
        originHeader: h.get("origin"),
        configuredSiteUrl: settings.seo_site_url,
      }),
      expectedUserId: userId,
    });
    if (!stripeResult.ok) {
      return {
        ok: true,
        orderId,
        stripeCheckoutError: stripeResult.error,
        stripePaymentStatus: "pending",
      };
    }
    if (stripeResult.status === "redirect") {
      return {
        ok: true,
        orderId,
        stripeCheckoutUrl: stripeResult.url,
        stripePaymentStatus: "pending",
      };
    }
    return { ok: true, orderId, stripePaymentStatus: stripeResult.status };
  }

  // 4. When using Plisio, immediately generate the unique Plisio invoice for this order
  if (paymentMethod === "plisio" && plisioCurrency) {
    const h = await headers();
    const origin =
      h.get("origin") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "http://localhost:3000";
    const invoiceRes = await createPlisioOrderInvoice({
      orderId,
      cid: plisioCurrency.cid,
      siteOrigin: origin,
    });
    if (!invoiceRes.ok) {
      return { ok: false, error: invoiceRes.error };
    }
    return { ok: true, orderId, plisioInvoice: invoiceRes.invoice };
  }

  return { ok: true, orderId };
}

/**
 * Reopens (or safely recreates after expiry/failure) the hosted Stripe
 * Checkout Session for one of the signed-in customer's unpaid Stripe orders.
 */
export async function resumeStripeCheckout(orderId: string): Promise<never> {
  if (!UUID_RE.test(orderId)) redirect("/orders");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId =
    claims?.claims && typeof (claims.claims as { sub?: unknown }).sub === "string"
      ? (claims.claims as { sub: string }).sub
      : null;
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/orders/${orderId}`)}`);

  const { data: ownedOrder } = await supabase
    .from("orders")
    .select("payment_method, payment_protocol, payment_network, payment_address, payment_tx_id, notes")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  const paymentInfo = ownedOrder
    ? parseOrderPaymentInfo({
        ...(ownedOrder as Record<string, unknown>),
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
      } as Parameters<typeof parseOrderPaymentInfo>[0])
    : null;
  if (!paymentInfo?.isStripe) redirect(`/orders/${orderId}?stripe=session-error`);

  const [h, settings] = await Promise.all([headers(), getSiteSettingsFresh()]);
  const result = await createStripeCheckoutSessionForOrder({
    orderId,
    siteOrigin: resolveStripeSiteOrigin({
      originHeader: h.get("origin"),
      configuredSiteUrl: settings.seo_site_url,
    }),
    expectedUserId: userId,
  });

  if (result.ok && result.status === "redirect") redirect(result.url);
  if (result.ok && result.status === "paid") redirect(`/orders/${orderId}?placed=1&stripe=success`);
  if (result.ok && result.status === "pending") redirect(`/orders/${orderId}?stripe=processing`);
  redirect(`/orders/${orderId}?stripe=session-error`);
}

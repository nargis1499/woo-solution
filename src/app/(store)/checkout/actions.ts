"use server";

import { headers } from "next/headers";
import {
  formatOrderNotesWithPayment,
  type OrderPaymentInput,
} from "@/lib/order-payment";
import { resolvePlisioCurrency, type PlisioInvoiceSession } from "@/lib/plisio";
import { createPlisioOrderInvoice } from "@/lib/plisio.server";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { ShippingInput } from "@/lib/types";

export type PlaceOrderInput = {
  items: { product_id: string; variation_id?: string | null; quantity: number }[];
  shipping: ShippingInput;
  payment?: OrderPaymentInput;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; plisioInvoice?: PlisioInvoiceSession }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  // ── validate payload shape (the DB function validates business rules) ──
  const items = Array.isArray(input?.items)
    ? input.items
        .filter((i) => i && UUID_RE.test(String(i.product_id)))
        .map((i) => ({
          product_id: String(i.product_id),
          variation_id:
            i.variation_id && UUID_RE.test(String(i.variation_id))
              ? String(i.variation_id)
              : null,
          quantity: Math.floor(Number(i.quantity)),
        }))
        .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0)
    : [];

  if (items.length === 0) return { ok: false, error: "Your cart is empty." };

  const rawMethod = input.payment?.method;
  const paymentMethod: "cod" | "crypto" | "plisio" =
    rawMethod === "plisio"
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

  const { data, error } = await supabase.rpc("place_order", {
    p_items: items,
    p_shipping: shipping,
  });

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

  // 3. When using Plisio, immediately generate the unique Plisio invoice for this order
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

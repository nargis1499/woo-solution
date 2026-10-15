"use server";

import { createClient } from "@/lib/supabase/server";
import type { ShippingInput } from "@/lib/types";

export type PlaceOrderInput = {
  items: { product_id: string; quantity: number }[];
  shipping: ShippingInput;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string }
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
          quantity: Math.floor(Number(i.quantity)),
        }))
        .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0)
    : [];

  if (items.length === 0) return { ok: false, error: "Your cart is empty." };

  const shipping = {
    name: clean(input.shipping?.name, 120),
    phone: clean(input.shipping?.phone, 40),
    address_line1: clean(input.shipping?.address_line1),
    address_line2: clean(input.shipping?.address_line2),
    city: clean(input.shipping?.city, 100),
    postal_code: clean(input.shipping?.postal_code, 20),
    country: clean(input.shipping?.country, 100),
    notes: clean(input.shipping?.notes, 1000),
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

  return { ok: true, orderId: String(data) };
}

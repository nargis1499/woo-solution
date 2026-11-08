/**
 * Pure helpers for order shipment & tracking numbers (migration 20261051 + 20261064).
 *
 * Shared by:
 *   - Admin order detail form (`src/components/admin/order-form.tsx`)
 *   - Admin order update action (`src/app/nemesis/actions.ts`)
 *   - Customer & Admin order detail/list views
 */

export const FULFILLMENT_STATUSES = ["unfulfilled", "packed", "shipped", "delivered"] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export type StoredFulfillmentStatus = FulfillmentStatus | "unknown";

export const SHIPPING_STATUSES = ["pending", "in_transit", "delayed", "delivered"] as const;
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];
export type StoredShippingStatus = ShippingStatus | "unknown";

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  unfulfilled: "Unfulfilled",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
};

export const SHIPPING_STATUS_LABELS: Record<ShippingStatus, string> = {
  pending: "Pending dispatch",
  in_transit: "In transit",
  delayed: "Delayed",
  delivered: "Delivered",
};

export type ShippingCarrierPreset = {
  name: string;
  shortLabel: string;
  buildUrl?: (trackingNumber: string) => string;
};

const encode = (trackingNumber: string) => encodeURIComponent(trackingNumber.trim());

export const SHIPPING_CARRIER_PRESETS: readonly ShippingCarrierPreset[] = [
  {
    name: "DHL Express",
    shortLabel: "DHL",
    buildUrl: (t) => `https://www.dhl.com/en/express/tracking.html?AWB=${encode(t)}`,
  },
  {
    name: "FedEx",
    shortLabel: "FedEx",
    buildUrl: (t) => `https://www.fedex.com/fedextrack/?trknbr=${encode(t)}`,
  },
  {
    name: "UPS",
    shortLabel: "UPS",
    buildUrl: (t) => `https://www.ups.com/track?tracknum=${encode(t)}`,
  },
  {
    name: "USPS",
    shortLabel: "USPS",
    buildUrl: (t) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encode(t)}`,
  },
  {
    name: "Royal Mail",
    shortLabel: "Royal Mail",
    buildUrl: (t) => `https://www.royalmail.com/track-your-item#/tracking-results/${encode(t)}`,
  },
  {
    name: "Canada Post",
    shortLabel: "Canada Post",
    buildUrl: (t) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${encode(t)}`,
  },
  {
    name: "Australia Post",
    shortLabel: "AusPost",
    buildUrl: (t) => `https://auspost.com.au/mypost/track/#/details/${encode(t)}`,
  },
  {
    name: "Aramex",
    shortLabel: "Aramex",
    buildUrl: (t) => `https://www.aramex.com/us/en/track/shipments?ShipmentNumber=${encode(t)}`,
  },
  {
    name: "DPD",
    shortLabel: "DPD",
    buildUrl: (t) => `https://www.dpd.com/en/mydpd/my-parcels/incoming/?parcelNumber=${encode(t)}`,
  },
  {
    name: "Steadfast Courier",
    shortLabel: "Steadfast",
    buildUrl: (t) => `https://steadfast.com.bd/t/${encode(t)}`,
  },
  {
    name: "RedX",
    shortLabel: "RedX",
    buildUrl: (t) => `https://redx.com.bd/track-global-parcel/?trackingId=${encode(t)}`,
  },
  {
    name: "Pathao Courier",
    shortLabel: "Pathao",
  },
] as const;

export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === "string" && (FULFILLMENT_STATUSES as readonly string[]).includes(value);
}

export function normaliseFulfillmentStatus(value: unknown): FulfillmentStatus {
  return isFulfillmentStatus(value) ? value : "unfulfilled";
}

export function isShippingStatus(value: unknown): value is ShippingStatus {
  return typeof value === "string" && (SHIPPING_STATUSES as readonly string[]).includes(value);
}

export function normaliseShippingStatus(value: unknown, fulfillment: FulfillmentStatus = "unfulfilled"): ShippingStatus {
  if (isShippingStatus(value)) return value;
  if (fulfillment === "delivered") return "delivered";
  if (fulfillment === "shipped") return "in_transit";
  return "pending";
}

/**
 * Matches the database check in `nemesis_validate_order_action`:
 * tracking URLs must use HTTPS and contain no whitespace.
 */
export function isValidTrackingUrl(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return true;
  if (trimmed.length > 1000 || !/^https:\/\/[^\s]+$/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Builds an official carrier tracking URL when a known carrier and tracking
 * number are present. Returns `null` when the carrier has no public URL template
 * or the tracking number is blank.
 */
export function buildCarrierTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const c = (carrier ?? "").trim().toLowerCase();
  const num = (trackingNumber ?? "").trim();
  if (!c || !num) return null;

  if (/\bdhl\b/.test(c)) return `https://www.dhl.com/en/express/tracking.html?AWB=${encode(num)}`;
  if (/\bfedex\b/.test(c)) return `https://www.fedex.com/fedextrack/?trknbr=${encode(num)}`;
  if (/\bups\b/.test(c)) return `https://www.ups.com/track?tracknum=${encode(num)}`;
  if (/\busps\b|united states postal/.test(c)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encode(num)}`;
  }
  if (/royal\s*mail/.test(c)) {
    return `https://www.royalmail.com/track-your-item#/tracking-results/${encode(num)}`;
  }
  if (/canada\s*post/.test(c)) {
    return `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${encode(num)}`;
  }
  if (/australia\s*post|auspost/.test(c)) {
    return `https://auspost.com.au/mypost/track/#/details/${encode(num)}`;
  }
  if (/\baramex\b/.test(c)) {
    return `https://www.aramex.com/us/en/track/shipments?ShipmentNumber=${encode(num)}`;
  }
  if (/\bdpd\b/.test(c)) {
    return `https://www.dpd.com/en/mydpd/my-parcels/incoming/?parcelNumber=${encode(num)}`;
  }
  if (/\bsteadfast\b/.test(c)) {
    return `https://steadfast.com.bd/t/${encode(num)}`;
  }
  if (/\bredx\b/.test(c)) {
    return `https://redx.com.bd/track-global-parcel/?trackingId=${encode(num)}`;
  }

  return null;
}

export type OrderTrackingSummary = {
  fulfillmentStatus: FulfillmentStatus;
  fulfillmentLabel: string;
  shippingStatus: ShippingStatus;
  shippingStatusLabel: string;
  carrier: string | null;
  trackingNumber: string | null;
  explicitTrackingUrl: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  hasTracking: boolean;
  stepIndex: 0 | 1 | 2 | 3;
};

export function resolveOrderTracking(order: {
  fulfillment_status?: string | null;
  shipping_status?: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
}): OrderTrackingSummary {
  const carrier = (order.shipping_carrier ?? "").trim() || null;
  const trackingNumber = (order.tracking_number ?? "").trim() || null;
  const rawUrl = (order.tracking_url ?? "").trim();
  const explicitTrackingUrl = rawUrl && isValidTrackingUrl(rawUrl) ? rawUrl : null;
  const trackingUrl = explicitTrackingUrl ?? buildCarrierTrackingUrl(carrier, trackingNumber);

  let fulfillmentStatus = normaliseFulfillmentStatus(order.fulfillment_status);
  // If an order has a tracking number or shipped_at timestamp while fulfillment_status
  // was left at the default 'unfulfilled'/'unknown', treat it as at least 'shipped'.
  if (
    fulfillmentStatus === "unfulfilled" &&
    (order.delivered_at || order.shipping_status === "delivered")
  ) {
    fulfillmentStatus = "delivered";
  } else if (
    fulfillmentStatus === "unfulfilled" &&
    (trackingNumber || order.shipped_at || order.shipping_status === "in_transit")
  ) {
    fulfillmentStatus = "shipped";
  }

  const shippingStatus = normaliseShippingStatus(order.shipping_status, fulfillmentStatus);
  const stepIndex: 0 | 1 | 2 | 3 =
    fulfillmentStatus === "delivered"
      ? 3
      : fulfillmentStatus === "shipped"
        ? 2
        : fulfillmentStatus === "packed"
          ? 1
          : 0;

  const hasTracking = Boolean(
    carrier ||
      trackingNumber ||
      trackingUrl ||
      fulfillmentStatus !== "unfulfilled" ||
      order.shipped_at ||
      order.delivered_at,
  );

  return {
    fulfillmentStatus,
    fulfillmentLabel: FULFILLMENT_STATUS_LABELS[fulfillmentStatus],
    shippingStatus,
    shippingStatusLabel: SHIPPING_STATUS_LABELS[shippingStatus],
    carrier,
    trackingNumber,
    explicitTrackingUrl,
    trackingUrl,
    shippedAt: order.shipped_at ?? null,
    deliveredAt: order.delivered_at ?? null,
    hasTracking,
    stepIndex,
  };
}

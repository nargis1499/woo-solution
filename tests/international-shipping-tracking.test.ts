import { describe, expect, it } from "vitest";
import {
  calculateShippingMicros,
  FLAT_SHIPPING_MICROS,
  getShippingThresholdStatus,
} from "@/lib/config";
import {
  ORDER_COLUMNS,
  ORDER_COLUMNS_NO_TRACKING,
  withOrderColumns,
} from "@/lib/data/order-columns";
import {
  CURRENCIES,
  CURRENCY_CODES,
  formatMoney,
  isCurrencyCode,
  moneyFromSettings,
  orderMoney,
  toBaseMicros,
  toDisplayMinor,
  usdMicros,
} from "@/lib/money";
import {
  buildCarrierTrackingUrl,
  isValidTrackingUrl,
  resolveOrderTracking,
} from "@/lib/order-tracking";
import { normaliseSiteSettings } from "@/lib/site-settings";
import { resolveQuickCheckoutTiers } from "@/lib/quick-checkout";
import { stripeMinorUnitsFromUsdMicros } from "@/lib/stripe";
import type { Product } from "@/lib/types";

describe("International multi-currency support", () => {
  it("supports 14 global currencies with positive suggested rates and round-trip minor conversion", () => {
    expect(CURRENCY_CODES).toEqual([
      "USD",
      "EUR",
      "GBP",
      "CAD",
      "AUD",
      "SGD",
      "CHF",
      "AED",
      "SAR",
      "INR",
      "BDT",
      "MYR",
      "BRL",
      "MXN",
    ]);

    const baseMicros = usdMicros(49.99);
    for (const code of CURRENCY_CODES) {
      expect(isCurrencyCode(code)).toBe(true);
      const meta = CURRENCIES[code];
      expect(meta.suggestedRate).toBeGreaterThan(0);

      const money = moneyFromSettings({
        currency: code,
        usd_to_bdt_rate: code === "USD" ? null : meta.suggestedRate,
      });
      expect(money.currency).toBe(code);
      expect(money.rate).toBe(code === "USD" ? 1 : meta.suggestedRate);

      const displayMinor = toDisplayMinor(baseMicros, money);
      const stripeMinor = stripeMinorUnitsFromUsdMicros(baseMicros, code, money.rate);
      expect(stripeMinor).toBe(displayMinor);

      const roundTripped = toBaseMicros(displayMinor, money);
      expect(toDisplayMinor(roundTripped, money)).toBe(displayMinor);
    }
  });

  it("falls back to USD when a non-USD currency has no valid exchange rate", () => {
    expect(moneyFromSettings({ currency: "EUR", usd_to_bdt_rate: null })).toEqual({
      currency: "USD",
      rate: 1,
    });
    expect(moneyFromSettings({ currency: "GBP", usd_to_bdt_rate: 0 })).toEqual({
      currency: "USD",
      rate: 1,
    });
    expect(orderMoney({ currency: "CAD", exchange_rate: 1.38 })).toEqual({
      currency: "CAD",
      rate: 1.38,
    });
    expect(formatMoney(usdMicros(100), { currency: "EUR", rate: 0.92 })).toBe("€92.00");
    expect(formatMoney(usdMicros(100), { currency: "GBP", rate: 0.79 })).toBe("£79.00");
  });
});

describe("Free-shipping threshold calculation & progress", () => {
  it("applies flat-rate shipping below the threshold and zeroes shipping at or above the threshold", () => {
    const config = {
      enabled: true,
      rateMicros: FLAT_SHIPPING_MICROS,
      freeThresholdMicros: usdMicros(50),
    };

    expect(calculateShippingMicros(0, config)).toBe(0);
    expect(calculateShippingMicros(usdMicros(30), config)).toBe(FLAT_SHIPPING_MICROS);
    expect(calculateShippingMicros(usdMicros(49.99), config)).toBe(FLAT_SHIPPING_MICROS);
    expect(calculateShippingMicros(usdMicros(50), config)).toBe(0);
    expect(calculateShippingMicros(usdMicros(120), config)).toBe(0);
  });

  it("computes remaining spend and progress percentage toward free shipping", () => {
    const config = {
      enabled: true,
      rateMicros: FLAT_SHIPPING_MICROS,
      freeThresholdMicros: usdMicros(100),
    };

    expect(getShippingThresholdStatus(usdMicros(35), config)).toEqual({
      active: true,
      unlocked: false,
      thresholdMicros: usdMicros(100),
      remainingMicros: usdMicros(65),
      progressPercent: 35,
    });

    expect(getShippingThresholdStatus(usdMicros(100), config)).toEqual({
      active: true,
      unlocked: true,
      thresholdMicros: usdMicros(100),
      remainingMicros: 0,
      progressPercent: 100,
    });

    expect(
      getShippingThresholdStatus(usdMicros(35), {
        enabled: true,
        rateMicros: FLAT_SHIPPING_MICROS,
        freeThresholdMicros: null,
      }),
    ).toBeNull();
  });

  it("normalises free_shipping_threshold_micros from site_settings row and metadata fallback", () => {
    expect(normaliseSiteSettings({}).free_shipping_threshold_micros).toBeNull();
    expect(
      normaliseSiteSettings({ free_shipping_threshold_micros: "75000000" }).free_shipping_threshold_micros,
    ).toBe(75_000_000);
    expect(
      normaliseSiteSettings({
        theme_gradients: { free_shipping_threshold_micros: 50_000_000 },
      }).free_shipping_threshold_micros,
    ).toBe(50_000_000);
  });
});

describe("Order tracking & fulfillment helpers", () => {
  it("builds official HTTPS tracking URLs for major international and regional carriers", () => {
    expect(buildCarrierTrackingUrl("DHL Express", "1234567890")).toBe(
      "https://www.dhl.com/en/express/tracking.html?AWB=1234567890",
    );
    expect(buildCarrierTrackingUrl("FedEx", "999888777")).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=999888777",
    );
    expect(buildCarrierTrackingUrl("UPS", "1Z999AA10123456784")).toBe(
      "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    );
    expect(buildCarrierTrackingUrl("Steadfast Courier", "SF-42")).toBe(
      "https://steadfast.com.bd/t/SF-42",
    );
    expect(buildCarrierTrackingUrl("Custom Local Rider", "LOC-1")).toBeNull();
  });

  it("validates custom tracking URLs require HTTPS without spaces", () => {
    expect(isValidTrackingUrl("")).toBe(true);
    expect(isValidTrackingUrl(null)).toBe(true);
    expect(isValidTrackingUrl("https://track.example.com/pkg/123")).toBe(true);
    expect(isValidTrackingUrl("http://track.example.com/pkg/123")).toBe(false);
    expect(isValidTrackingUrl("https://track.example.com/with space")).toBe(false);
  });

  it("resolves order tracking state, step progress, and auto-generated carrier links", () => {
    const unfulfilled = resolveOrderTracking({ fulfillment_status: "unknown" });
    expect(unfulfilled.hasTracking).toBe(false);
    expect(unfulfilled.fulfillmentStatus).toBe("unfulfilled");
    expect(unfulfilled.stepIndex).toBe(0);

    const autoShipped = resolveOrderTracking({
      fulfillment_status: "unfulfilled",
      shipping_carrier: "DHL Express",
      tracking_number: "AWB-778899",
    });
    expect(autoShipped.hasTracking).toBe(true);
    expect(autoShipped.fulfillmentStatus).toBe("shipped");
    expect(autoShipped.stepIndex).toBe(2);
    expect(autoShipped.trackingUrl).toBe(
      "https://www.dhl.com/en/express/tracking.html?AWB=AWB-778899",
    );

    const delivered = resolveOrderTracking({
      fulfillment_status: "delivered",
      shipping_carrier: "FedEx",
      tracking_number: "FDX-100",
      tracking_url: "https://custom.example.com/track/FDX-100",
      delivered_at: "2026-11-03T12:00:00Z",
    });
    expect(delivered.fulfillmentStatus).toBe("delivered");
    expect(delivered.stepIndex).toBe(3);
    expect(delivered.trackingUrl).toBe("https://custom.example.com/track/FDX-100");
  });

  it("falls back cleanly when querying a database without tracking columns", async () => {
    const calls: string[] = [];
    const result = await withOrderColumns(async (cols) => {
      calls.push(cols);
      if (cols === ORDER_COLUMNS) {
        return {
          data: null,
          error: { code: "42703", message: "column orders.tracking_number does not exist" },
        };
      }
      return { data: [{ id: "ord-1" }], error: null };
    });

    expect(calls).toEqual([ORDER_COLUMNS, ORDER_COLUMNS_NO_TRACKING]);
    expect(result.error).toBeNull();
  });
});

describe("Quick Checkout shipping & tier calculation", () => {
  it("applies flat shipping rate below free-shipping threshold and unlocks free shipping on higher tiers", () => {
    const product: Product = {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Verified Business Proxy",
      slug: "verified-business-proxy",
      description: null,
      price_micros: 39_900_000,
      compare_at_price_micros: null,
      sku: "VBP-1",
      stock: 100,
      manage_stock: true,
      type: "simple",
      image_url: null,
      category_id: null,
      is_active: true,
      is_featured: false,
      created_at: "2026-11-03T00:00:00Z",
      updated_at: "2026-11-03T00:00:00Z",
    };

    const tiers = resolveQuickCheckoutTiers(product);
    const shippingConfig = {
      enabled: true,
      rateMicros: 5_000_000,
      freeThresholdMicros: 108_695_652, // €100.00 at 0.92 EUR/USD
    };

    // 1x tier ($39.90 / €36.71) is below threshold -> adds $5.00 (€4.60) shipping
    const tier1x = tiers.find((t) => t.quantity === 1)!;
    expect(tier1x.priceMicros).toBe(39_900_000);
    const ship1x = calculateShippingMicros(tier1x.priceMicros, shippingConfig);
    expect(ship1x).toBe(5_000_000);
    expect(tier1x.priceMicros + ship1x).toBe(44_900_000);
    expect(getShippingThresholdStatus(tier1x.priceMicros, shippingConfig)?.unlocked).toBe(
      false,
    );

    // 5x tier ($199.50 / €183.54) exceeds threshold -> shipping is 0 (Free)
    const tier5x = tiers.find((t) => t.quantity === 5)!;
    expect(tier5x.priceMicros).toBe(199_500_000);
    const ship5x = calculateShippingMicros(tier5x.priceMicros, shippingConfig);
    expect(ship5x).toBe(0);
    expect(tier5x.priceMicros + ship5x).toBe(199_500_000);
    expect(getShippingThresholdStatus(tier5x.priceMicros, shippingConfig)?.unlocked).toBe(
      true,
    );
  });
});


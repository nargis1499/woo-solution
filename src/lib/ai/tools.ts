import "server-only";
import { assertAdmin } from "@/lib/admin/auth";
import { expireTag, revalidateStore, UUID_RE } from "@/lib/admin/form";
import { PAGES_TAG, pageTag } from "@/lib/data/pages";
import { POSTS_TAG, postTag } from "@/lib/data/posts";
import { formatOrderNumber } from "@/lib/format";
import { mediaUrl } from "@/lib/media/shared";
import { formatMoney, moneyFromSettings, type Money } from "@/lib/money";
import { htmlToText, truncate } from "@/lib/pages/shared";
import { getSiteSettingsFresh } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import {
  runModelCompletion,
  type AiToolCall,
  type AiToolSpec,
} from "@/lib/ai/client";
import type { AiSettingsServer } from "@/lib/ai/providers";
import type {
  AiActionPlan,
  AiActionPlanItem,
  AiToolBadge,
} from "@/lib/ai/types";

/* ──────────────────────────────────────────────────────────────────────────
 * Nemesis AI Agent Tool Suite + Stateless Zero-Token Plan Executor
 *  - Read tools execute immediately and return compact JSON (8k-TPM friendly)
 *  - Write tools build deterministic `AiActionPlan` previews in TypeScript
 *  - `executeApprovedPlan()` applies checked items directly in Supabase
 *    without calling the LLM again (0 extra tokens, 100% accurate math)
 * ────────────────────────────────────────────────────────────────────────── */

export const AGENT_TOOLS: AiToolSpec[] = [
  {
    name: "get_store_analytics",
    description:
      "Get store revenue (7d, 30d, all-time), order counts by status, top-selling products, recent pending orders, and catalog summary.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Lookback window in days for recent sales & top products (default 7).",
        },
      },
    },
  },
  {
    name: "query_inventory",
    description:
      "Search or filter store products by category, stock threshold (e.g. stock < 3 -> maxStock: 2), out-of-stock status, active/draft state, or keyword.",
    parameters: {
      type: "object",
      properties: {
        categorySlug: {
          type: "string",
          description: "Category slug from the store category list (optional).",
        },
        maxStock: {
          type: "number",
          description:
            "Maximum stock level inclusive (e.g. use 2 for 'less than 3 stock', 0 for out of stock).",
        },
        outOfStockOnly: {
          type: "boolean",
          description: "If true, only return products with 0 available stock.",
        },
        status: {
          type: "string",
          enum: ["active", "draft", "all"],
          description: "Filter by active (published) or draft (hidden) products.",
        },
        search: {
          type: "string",
          description: "Optional product name or SKU keyword.",
        },
      },
    },
  },
  {
    name: "preview_category_discount",
    description:
      "Prepare a confirmation preview to apply a percentage discount (or 0 to clear discounts) on products in a category or matching a keyword, setting compare_at_price_micros and new price_micros.",
    parameters: {
      type: "object",
      properties: {
        categorySlug: {
          type: "string",
          description: "Category slug to discount (e.g. 'mobile-phones', 'headphones').",
        },
        search: {
          type: "string",
          description: "Optional keyword filter if discounting specific named products.",
        },
        discountPercent: {
          type: "number",
          description: "Discount percentage from 0 to 90 (use 0 to remove sale discounts).",
        },
        activeOnly: {
          type: "boolean",
          description: "Only include active/published products (default true).",
        },
      },
      required: ["discountPercent"],
    },
  },
  {
    name: "preview_product_status_update",
    description:
      "Prepare a confirmation preview to move matching products (e.g. out-of-stock items in a category) into draft (hidden) or active (published) state, or toggle featured status.",
    parameters: {
      type: "object",
      properties: {
        categorySlug: {
          type: "string",
          description: "Optional category slug filter.",
        },
        outOfStockOnly: {
          type: "boolean",
          description: "If true, match only products with 0 total stock.",
        },
        maxStock: {
          type: "number",
          description: "Optional max stock inclusive filter.",
        },
        search: {
          type: "string",
          description: "Optional product name/SKU keyword filter.",
        },
        targetStatus: {
          type: "string",
          enum: ["draft", "active"],
          description: "'draft' hides products from the storefront; 'active' publishes them.",
        },
        isFeatured: {
          type: "boolean",
          description: "Optional flag to mark/unmark matched products as featured.",
        },
      },
    },
  },
  {
    name: "audit_and_fix_seo",
    description:
      "Audit products, blog posts, CMS pages, and media images for missing descriptions, SEO meta descriptions, or image alt text, and prepare ready-to-apply SEO fixes.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "products", "posts", "pages", "media"],
          description: "Which part of the store to audit and generate fixes for (default 'all').",
        },
        limit: {
          type: "number",
          description: "Max items to generate fixes for in one batch (default 10, max 25).",
        },
      },
    },
  },
  {
    name: "preview_order_status_update",
    description:
      "Prepare a confirmation preview to update an order's status by order number (e.g. 1004).",
    parameters: {
      type: "object",
      properties: {
        orderNumber: {
          type: "number",
          description: "Numeric order_number (e.g. 1001).",
        },
        newStatus: {
          type: "string",
          enum: ["pending", "processing", "completed", "cancelled"],
          description: "Target order status.",
        },
      },
      required: ["orderNumber", "newStatus"],
    },
  },
];

export type StoreContextSummary = {
  storeName: string;
  currency: string;
  manageStock: boolean;
  categories: Array<{ name: string; slug: string; id: string }>;
};

export async function loadStoreContextSummary(): Promise<{
  context: StoreContextSummary;
  money: Money;
}> {
  await assertAdmin();
  const [settings, supabase] = await Promise.all([
    getSiteSettingsFresh(),
    createClient(),
  ]);
  const { data: catRows } = await supabase
    .from("categories")
    .select("id, name, slug")
    .order("sort_order", { ascending: true });
  const money = moneyFromSettings(settings);
  return {
    money,
    context: {
      storeName: settings.store_name,
      currency: money.currency,
      manageStock: settings.manage_stock,
      categories: (catRows ?? []) as Array<{ id: string; name: string; slug: string }>,
    },
  };
}

export function buildAgentSystemPrompt(
  aiSettings: AiSettingsServer,
  store: StoreContextSummary,
): string {
  const catList =
    store.categories.length > 0
      ? store.categories.map((c) => `${c.name} (${c.slug})`).join(", ")
      : "none yet";
  const customNote = aiSettings.system_instructions
    ? `\nStore custom instructions: ${aiSettings.system_instructions}`
    : "";

  return [
    `You are Nemesis AI, the store operations agent inside the "${store.storeName}" admin dashboard.`,
    `Store currency: ${store.currency}. Stock tracking: ${store.manageStock ? "enabled" : "disabled"}.`,
    `Available categories (Name (slug)): ${catList}.`,
    `Brand tone: ${aiSettings.brand_tone}. Respond in ${aiSettings.default_language}.`,
    `Rules:`,
    `1. Always use the provided tools for live store numbers, inventory checks, discounts, status updates, order updates, and SEO audits. Never guess IDs or prices.`,
    `2. Map user category mentions (e.g. "mobile", "headphones", "accessories") to the closest slug from Available categories above.`,
    `3. Write tools create a safe Confirmation Preview Card automatically—tell the admin clearly that the preview is ready below and they can click "Apply All" to commit changes.`,
    `4. Keep responses concise, scannable, and helpful (use short bullet points when listing items).${customNote}`,
  ].join("\n");
}

type RawProductRow = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_micros: number;
  compare_at_price_micros: number | null;
  image_url: string | null;
  image_media_id?: string | null;
  type?: "simple" | "variable";
  sku?: string | null;
  brand?: string | null;
  features?: string | null;
  stock: number;
  is_active: boolean;
  is_featured: boolean;
  category?: { id: string; name: string; slug: string } | null;
  variations?: Array<{
    id: string;
    label: string;
    sku: string | null;
    price_micros: number;
    compare_at_price_micros: number | null;
    stock: number;
    is_active: boolean;
  }>;
  image_media?: {
    id: string;
    name: string;
    path: string;
    alt: string | null;
  } | null;
};

function effectiveProductStock(p: RawProductRow): number {
  if (p.type === "variable" && p.variations && p.variations.length > 0) {
    return p.variations
      .filter((v) => v.is_active)
      .reduce((sum, v) => sum + Math.max(0, v.stock), 0);
  }
  return Math.max(0, p.stock);
}

function stockBadgeFor(stock: number): AiActionPlanItem["stockBadge"] {
  if (stock <= 0) return { label: "Out of stock", tone: "rose" };
  if (stock <= 3) return { label: `${stock} left`, tone: "amber" };
  return { label: `${stock} in stock`, tone: "emerald" };
}

function resolveCategoryMatch(
  categories: StoreContextSummary["categories"],
  rawSlugOrName: unknown,
): { id: string; name: string; slug: string } | null {
  if (typeof rawSlugOrName !== "string" || !rawSlugOrName.trim()) return null;
  const q = rawSlugOrName.trim().toLowerCase();
  return (
    categories.find((c) => c.slug.toLowerCase() === q) ??
    categories.find((c) => c.name.toLowerCase() === q) ??
    categories.find(
      (c) =>
        c.slug.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        q.includes(c.slug.toLowerCase()),
    ) ??
    null
  );
}

async function fetchAdminProductsForTools(): Promise<RawProductRow[]> {
  const supabase = await createClient();
  const fullSelect =
    "id, category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, image_media_id, type, sku, brand, features, stock, is_active, is_featured, category:categories(id, name, slug), variations:product_variations(id, label, sku, price_micros, compare_at_price_micros, stock, is_active), image_media:media!products_image_media_id_fkey(id, name, path, alt)";
  const fallbackSelect =
    "id, category_id, name, slug, description, price_micros, compare_at_price_micros, image_url, stock, is_active, is_featured, category:categories(id, name, slug)";

  const { data, error } = await supabase
    .from("products")
    .select(fullSelect)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!error) return (data ?? []) as unknown as RawProductRow[];

  const retry = await supabase
    .from("products")
    .select(fallbackSelect)
    .order("created_at", { ascending: false })
    .limit(500);
  if (retry.error) throw new Error(`Failed to query products: ${retry.error.message}`);
  return (retry.data ?? []) as unknown as RawProductRow[];
}

/* ── Tool Execution Dispatcher ───────────────────────────────────────────── */

export async function executeAgentToolCall(opts: {
  call: AiToolCall;
  aiSettings: AiSettingsServer;
  store: StoreContextSummary;
  money: Money;
  allowModelSubcall: boolean;
}): Promise<{
  toolOutputJson: string;
  badge: AiToolBadge;
  plan?: AiActionPlan;
}> {
  await assertAdmin();
  const { call, aiSettings, store, money } = opts;
  const maxRows = aiSettings.token_budget_mode === "economy" ? 15 : aiSettings.token_budget_mode === "standard" ? 30 : 60;

  /* 1. Store Analytics */
  if (call.name === "get_store_analytics") {
    const supabase = await createClient();
    const days = Math.max(1, Math.min(365, Number(call.arguments.days) || 7));
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

    const [{ data: statsData }, { data: recentOrders }, products] = await Promise.all([
      supabase.rpc("admin_stats"),
      supabase
        .from("orders")
        .select(
          "id, order_number, status, payment_status, total_micros, shipping_name, created_at, order_items(product_name, quantity, line_total_micros)",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      fetchAdminProductsForTools(),
    ]);

    const orders = (recentOrders ?? []) as Array<{
      id: string;
      order_number: number;
      status: string;
      payment_status: string;
      total_micros: number;
      shipping_name: string;
      created_at: string;
      order_items?: Array<{
        product_name: string;
        quantity: number;
        line_total_micros: number;
      }>;
    }>;

    const windowOrders = orders.filter((o) => o.created_at >= sinceIso && o.status !== "cancelled");
    const windowRevenueMicros = windowOrders.reduce((s, o) => s + (o.total_micros ?? 0), 0);

    const byProduct = new Map<string, { name: string; units: number; revenueMicros: number }>();
    for (const o of windowOrders) {
      for (const item of o.order_items ?? []) {
        const cur = byProduct.get(item.product_name) ?? {
          name: item.product_name,
          units: 0,
          revenueMicros: 0,
        };
        cur.units += item.quantity ?? 0;
        cur.revenueMicros += item.line_total_micros ?? 0;
        byProduct.set(item.product_name, cur);
      }
    }

    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.revenueMicros - a.revenueMicros)
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        unitsSold: p.units,
        revenue: formatMoney(p.revenueMicros, money),
      }));

    const pendingOrders = orders
      .filter((o) => o.status === "pending")
      .slice(0, 6)
      .map((o) => ({
        orderNumber: formatOrderNumber(o.order_number),
        customer: o.shipping_name,
        total: formatMoney(o.total_micros, money),
        paymentStatus: o.payment_status,
        createdAt: o.created_at.slice(0, 10),
      }));

    const stats = (statsData ?? {}) as Record<string, number>;
    const outOfStockCount = products.filter((p) => p.is_active && effectiveProductStock(p) === 0).length;
    const lowStockCount = products.filter((p) => {
      const s = effectiveProductStock(p);
      return p.is_active && s > 0 && s <= 3;
    }).length;

    const payload = {
      windowDays: days,
      revenueWindow: formatMoney(windowRevenueMicros, money),
      ordersInWindow: windowOrders.length,
      revenue30d: formatMoney(stats.revenue_30d_micros ?? 0, money),
      revenueAllTime: formatMoney(stats.revenue_micros ?? 0, money),
      ordersByStatus: {
        pending: stats.orders_pending ?? 0,
        processing: stats.orders_processing ?? 0,
        completed: stats.orders_completed ?? 0,
        cancelled: stats.orders_cancelled ?? 0,
      },
      catalogHealth: {
        totalProducts: products.length,
        activeProducts: products.filter((p) => p.is_active).length,
        draftProducts: products.filter((p) => !p.is_active).length,
        activeOutOfStock: outOfStockCount,
        activeLowStockUpTo3: lowStockCount,
      },
      topProducts,
      pendingOrders,
    };

    return {
      toolOutputJson: JSON.stringify(payload),
      badge: {
        id: call.id,
        name: call.name,
        summary: `get_store_analytics(${days}d)`,
      },
    };
  }

  /* 2. Query Inventory */
  if (call.name === "query_inventory") {
    const products = await fetchAdminProductsForTools();
    const cat = resolveCategoryMatch(store.categories, call.arguments.categorySlug);
    const maxStock =
      typeof call.arguments.maxStock === "number" && Number.isFinite(call.arguments.maxStock)
        ? call.arguments.maxStock
        : null;
    const outOfStockOnly = call.arguments.outOfStockOnly === true;
    const statusFilter =
      typeof call.arguments.status === "string" ? call.arguments.status : "all";
    const search =
      typeof call.arguments.search === "string" ? call.arguments.search.trim().toLowerCase() : "";

    const matched = products.filter((p) => {
      if (cat && p.category_id !== cat.id && p.category?.slug !== cat.slug) return false;
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "draft" && p.is_active) return false;
      const stock = effectiveProductStock(p);
      if (outOfStockOnly && stock > 0) return false;
      if (maxStock !== null && stock > maxStock) return false;
      if (
        search &&
        !p.name.toLowerCase().includes(search) &&
        !(p.sku ?? "").toLowerCase().includes(search) &&
        !p.slug.toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });

    const summaryRows = matched.slice(0, maxRows).map((p) => ({
      name: p.name,
      slug: p.slug,
      sku: p.sku ?? null,
      category: p.category?.name ?? null,
      price: formatMoney(p.price_micros, money),
      compareAtPrice: p.compare_at_price_micros
        ? formatMoney(p.compare_at_price_micros, money)
        : null,
      stock: effectiveProductStock(p),
      status: p.is_active ? "active" : "draft",
    }));

    const parts = [
      cat ? cat.slug : "all",
      outOfStockOnly ? "stock=0" : maxStock !== null ? `stock<=${maxStock}` : null,
      statusFilter !== "all" ? statusFilter : null,
    ].filter(Boolean);

    return {
      toolOutputJson: JSON.stringify({
        matchedCount: matched.length,
        shownCount: summaryRows.length,
        items: summaryRows,
      }),
      badge: {
        id: call.id,
        name: call.name,
        summary: `query_inventory(${parts.join(", ")})`,
      },
    };
  }

  /* 3. Preview Category / Product Discount */
  if (call.name === "preview_category_discount") {
    const rawPct = Number(call.arguments.discountPercent);
    const pct = Number.isFinite(rawPct) ? Math.max(0, Math.min(90, Math.round(rawPct * 100) / 100)) : 10;
    const activeOnly = call.arguments.activeOnly !== false;
    const cat = resolveCategoryMatch(store.categories, call.arguments.categorySlug);
    const search =
      typeof call.arguments.search === "string" ? call.arguments.search.trim().toLowerCase() : "";

    if (call.arguments.categorySlug && !cat && !search) {
      return {
        toolOutputJson: JSON.stringify({
          error: `No category matched "${String(call.arguments.categorySlug)}". Available slugs: ${store.categories.map((c) => c.slug).join(", ")}`,
        }),
        badge: {
          id: call.id,
          name: call.name,
          summary: `preview_category_discount(no match)`,
        },
      };
    }

    const products = await fetchAdminProductsForTools();
    const matched = products.filter((p) => {
      if (activeOnly && !p.is_active) return false;
      if (cat && p.category_id !== cat.id && p.category?.slug !== cat.slug) return false;
      if (
        search &&
        !p.name.toLowerCase().includes(search) &&
        !(p.sku ?? "").toLowerCase().includes(search) &&
        !p.slug.toLowerCase().includes(search)
      ) {
        return false;
      }
      return Boolean(cat || search);
    });

    const items: AiActionPlanItem[] = matched.map((p) => {
      const baseMicros =
        p.compare_at_price_micros && p.compare_at_price_micros > p.price_micros
          ? p.compare_at_price_micros
          : p.price_micros;
      const newPriceMicros =
        pct === 0 ? baseMicros : Math.max(10_000, Math.round(baseMicros * (1 - pct / 100)));
      const newCompareAtMicros = pct === 0 ? null : baseMicros;

      const variationUpdates =
        p.type === "variable" && p.variations?.length
          ? p.variations.map((v) => {
              const vBase =
                v.compare_at_price_micros && v.compare_at_price_micros > v.price_micros
                  ? v.compare_at_price_micros
                  : v.price_micros;
              return {
                variationId: v.id,
                newPriceMicros:
                  pct === 0 ? vBase : Math.max(10_000, Math.round(vBase * (1 - pct / 100))),
                newCompareAtMicros: pct === 0 ? null : vBase,
              };
            })
          : undefined;

      const stock = effectiveProductStock(p);
      const thumbUrl = p.image_media?.path ? mediaUrl(p.image_media.path) : p.image_url;

      return {
        id: `disc_${p.id}`,
        title: p.name,
        subtitle: [p.category?.name, p.sku ? `SKU: ${p.sku}` : null].filter(Boolean).join(" · "),
        imageUrl: thumbUrl,
        oldValueLabel: formatMoney(baseMicros, money),
        newValueLabel: formatMoney(newPriceMicros, money),
        stockBadge: store.manageStock ? stockBadgeFor(stock) : undefined,
        mutation: {
          kind: "discount",
          productId: p.id,
          newPriceMicros,
          newCompareAtMicros,
          variationUpdates,
        },
      };
    });

    const targetLabel = cat ? cat.name : search ? `"${search}"` : "matched products";
    const plan: AiActionPlan | undefined =
      items.length > 0
        ? {
            id: `plan_discount_${Date.now()}`,
            title:
              pct === 0
                ? `Remove Sale Discount — ${items.length} ${items.length === 1 ? "Product" : "Products"}`
                : `${pct}% Discount on ${targetLabel} — ${items.length} ${items.length === 1 ? "Product" : "Products"} Ready`,
            description:
              pct === 0
                ? "Restores each product's compare-at price back to its regular price."
                : `Sets compare_at_price_micros to the base price and applies a ${pct}% sale discount.`,
            applyLabel: `Apply All (${items.length})`,
            items,
          }
        : undefined;

    return {
      toolOutputJson: JSON.stringify({
        status: items.length > 0 ? "preview_ready" : "no_matching_products",
        target: targetLabel,
        discountPercent: pct,
        matchedCount: items.length,
        lowStockInSelection: items
          .filter((i) => i.stockBadge && i.stockBadge.tone !== "emerald")
          .map((i) => ({ name: i.title, stock: i.stockBadge?.label })),
        sample: items.slice(0, 8).map((i) => ({
          name: i.title,
          from: i.oldValueLabel,
          to: i.newValueLabel,
          stock: i.stockBadge?.label,
        })),
      }),
      badge: {
        id: call.id,
        name: call.name,
        summary: `preview_category_discount(${cat?.slug ?? (search || "catalog")}, ${pct}%)`,
      },
      plan,
    };
  }

  /* 4. Preview Product Status / Draft / Featured Update */
  if (call.name === "preview_product_status_update") {
    const cat = resolveCategoryMatch(store.categories, call.arguments.categorySlug);
    const outOfStockOnly = call.arguments.outOfStockOnly === true;
    const maxStock =
      typeof call.arguments.maxStock === "number" && Number.isFinite(call.arguments.maxStock)
        ? call.arguments.maxStock
        : null;
    const search =
      typeof call.arguments.search === "string" ? call.arguments.search.trim().toLowerCase() : "";
    const targetStatus =
      call.arguments.targetStatus === "draft" || call.arguments.targetStatus === "active"
        ? call.arguments.targetStatus
        : undefined;
    const isFeatured =
      typeof call.arguments.isFeatured === "boolean" ? call.arguments.isFeatured : undefined;

    const products = await fetchAdminProductsForTools();
    const matched = products.filter((p) => {
      if (cat && p.category_id !== cat.id && p.category?.slug !== cat.slug) return false;
      const stock = effectiveProductStock(p);
      if (outOfStockOnly && stock > 0) return false;
      if (maxStock !== null && stock > maxStock) return false;
      if (
        search &&
        !p.name.toLowerCase().includes(search) &&
        !(p.sku ?? "").toLowerCase().includes(search) &&
        !p.slug.toLowerCase().includes(search)
      ) {
        return false;
      }
      if (targetStatus === "draft" && !p.is_active && isFeatured === undefined) return false;
      if (targetStatus === "active" && p.is_active && isFeatured === undefined) return false;
      return Boolean(cat || outOfStockOnly || maxStock !== null || search);
    });

    const items: AiActionPlanItem[] = matched.map((p) => {
      const stock = effectiveProductStock(p);
      const thumbUrl = p.image_media?.path ? mediaUrl(p.image_media.path) : p.image_url;
      const nextActive =
        targetStatus === "draft" ? false : targetStatus === "active" ? true : undefined;
      const oldLabel = p.is_active ? "Active" : "Draft";
      const newLabel =
        nextActive !== undefined
          ? nextActive
            ? "Active (Published)"
            : "Draft (Hidden)"
          : isFeatured
            ? "Featured"
            : "Unfeatured";

      return {
        id: `status_${p.id}`,
        title: p.name,
        subtitle: [p.category?.name, formatMoney(p.price_micros, money)].filter(Boolean).join(" · "),
        imageUrl: thumbUrl,
        oldValueLabel: oldLabel,
        newValueLabel: newLabel,
        stockBadge: store.manageStock ? stockBadgeFor(stock) : undefined,
        mutation: {
          kind: "product_status",
          productId: p.id,
          ...(nextActive !== undefined ? { isActive: nextActive } : {}),
          ...(isFeatured !== undefined ? { isFeatured } : {}),
        },
      };
    });

    const plan: AiActionPlan | undefined =
      items.length > 0
        ? {
            id: `plan_status_${Date.now()}`,
            title: `Update ${items.length} ${items.length === 1 ? "Product" : "Products"} → ${targetStatus === "draft" ? "Draft" : targetStatus === "active" ? "Active" : "Updated"}`,
            description: "Review the matched products below and click Apply All to update catalog visibility.",
            applyLabel: `Apply All (${items.length})`,
            items,
          }
        : undefined;

    return {
      toolOutputJson: JSON.stringify({
        status: items.length > 0 ? "preview_ready" : "no_matching_products",
        matchedCount: items.length,
        targetStatus: targetStatus ?? null,
        items: items.slice(0, 12).map((i) => ({
          name: i.title,
          change: `${i.oldValueLabel} -> ${i.newValueLabel}`,
          stock: i.stockBadge?.label,
        })),
      }),
      badge: {
        id: call.id,
        name: call.name,
        summary: `preview_product_status_update(${cat?.slug ?? "catalog"}, ${targetStatus ?? "featured"})`,
      },
      plan,
    };
  }

  /* 5. Audit & Fix Store SEO */
  if (call.name === "audit_and_fix_seo") {
    const supabase = await createClient();
    const scope =
      typeof call.arguments.scope === "string" ? call.arguments.scope : "all";
    const batchLimit = Math.max(
      1,
      Math.min(25, Number(call.arguments.limit) || (aiSettings.token_budget_mode === "economy" ? 8 : 14)),
    );

    const [products, postsRes, pagesRes] = await Promise.all([
      scope === "all" || scope === "products" || scope === "media"
        ? fetchAdminProductsForTools()
        : Promise.resolve([]),
      scope === "all" || scope === "posts"
        ? supabase
            .from("blog_posts")
            .select("id, title, slug, content, excerpt, seo_title, seo_description, status")
            .eq("status", "published")
            .limit(100)
        : Promise.resolve({ data: [] }),
      scope === "all" || scope === "pages"
        ? supabase
            .from("pages")
            .select("id, title, slug, content, excerpt, seo_title, seo_description, status")
            .eq("status", "published")
            .limit(100)
        : Promise.resolve({ data: [] }),
    ]);

    type MissingCandidate =
      | {
          type: "product_desc";
          id: string;
          name: string;
          brand?: string | null;
          category?: string | null;
          features?: string | null;
          imageUrl?: string | null;
        }
      | {
          type: "media_alt";
          mediaId: string;
          mediaName: string;
          mediaPath: string;
          contextTitle: string;
          brand?: string | null;
          category?: string | null;
        }
      | {
          type: "post_seo";
          id: string;
          title: string;
          snippet: string;
          missingExcerpt: boolean;
        }
      | {
          type: "page_seo";
          id: string;
          title: string;
          snippet: string;
        };

    const candidates: MissingCandidate[] = [];
    const seenMediaIds = new Set<string>();

    if (scope === "all" || scope === "products") {
      for (const p of products) {
        if (!p.is_active) continue;
        if (!p.description || p.description.trim().length < 20) {
          candidates.push({
            type: "product_desc",
            id: p.id,
            name: p.name,
            brand: p.brand,
            category: p.category?.name,
            features: p.features,
            imageUrl: p.image_media?.path ? mediaUrl(p.image_media.path) : p.image_url,
          });
        }
      }
    }

    if (scope === "all" || scope === "media" || scope === "products") {
      for (const p of products) {
        if (!p.image_media || seenMediaIds.has(p.image_media.id)) continue;
        if (!p.image_media.alt || !p.image_media.alt.trim()) {
          seenMediaIds.add(p.image_media.id);
          candidates.push({
            type: "media_alt",
            mediaId: p.image_media.id,
            mediaName: p.image_media.name,
            mediaPath: p.image_media.path,
            contextTitle: p.name,
            brand: p.brand,
            category: p.category?.name,
          });
        }
      }
    }

    if (scope === "all" || scope === "posts") {
      for (const post of (postsRes.data ?? []) as Array<{
        id: string;
        title: string;
        content: string;
        excerpt: string | null;
        seo_description: string | null;
      }>) {
        if (!post.seo_description?.trim() || !post.excerpt?.trim()) {
          candidates.push({
            type: "post_seo",
            id: post.id,
            title: post.title,
            snippet: truncate(htmlToText(post.content || ""), 220),
            missingExcerpt: !post.excerpt?.trim(),
          });
        }
      }
    }

    if (scope === "all" || scope === "pages") {
      for (const page of (pagesRes.data ?? []) as Array<{
        id: string;
        title: string;
        content: string;
        seo_description: string | null;
      }>) {
        if (!page.seo_description?.trim()) {
          candidates.push({
            type: "page_seo",
            id: page.id,
            title: page.title,
            snippet: truncate(htmlToText(page.content || ""), 220),
          });
        }
      }
    }

    const totalIssues = candidates.length;
    const selectedBatch = candidates.slice(0, batchLimit);

    // Default clean deterministic SEO copy (also serves as fallback or Browser-Direct Ollama copy)
    const generatedText = new Map<number, string>();
    selectedBatch.forEach((c, idx) => {
      if (c.type === "product_desc") {
        const qual = [c.brand, c.category].filter(Boolean).join(" ");
        const feat = c.features ? ` Key highlights include ${c.features}.` : "";
        generatedText.set(
          idx,
          truncate(
            `Discover the ${c.name}${qual ? ` (${qual})` : ""} at ${store.storeName}, crafted for reliable everyday performance and quality.${feat}`,
            240,
          ),
        );
      } else if (c.type === "media_alt") {
        const qual = [c.brand, c.category].filter(Boolean).join(" ");
        generatedText.set(
          idx,
          truncate(`${c.contextTitle}${qual ? ` – ${qual}` : ""} product photo`, 120),
        );
      } else if (c.type === "post_seo") {
        generatedText.set(
          idx,
          truncate(
            c.snippet || `Read "${c.title}" on the ${store.storeName} blog for insights and guides.`,
            155,
          ),
        );
      } else {
        generatedText.set(
          idx,
          truncate(
            c.snippet || `Learn more about ${c.title} at ${store.storeName}.`,
            155,
          ),
        );
      }
    });

    // Enhance with AI copywriter (uses worker/fallback model like GPT OSS 20B when available!)
    if (opts.allowModelSubcall && selectedBatch.length > 0) {
      try {
        const compactPromptItems = selectedBatch.map((c, idx) => {
          if (c.type === "product_desc") {
            return { idx, kind: "product_description", name: c.name, brand: c.brand, category: c.category, features: c.features };
          }
          if (c.type === "media_alt") {
            return { idx, kind: "image_alt_text", product: c.contextTitle, brand: c.brand, category: c.category, file: c.mediaName };
          }
          return { idx, kind: "meta_description_max_155_chars", title: c.title, snippet: c.snippet };
        });

        const copyRes = await runModelCompletion({
          settings: aiSettings,
          preferWorkerModel: true,
          systemPrompt: `Write concise, natural e-commerce SEO text in ${aiSettings.default_language} (${aiSettings.brand_tone} tone) for "${store.storeName}". Return ONLY a JSON array: [{"idx":0,"text":"..."}]. Keep meta_description <= 155 chars, image_alt_text <= 110 chars, product_description 1-2 sentences.`,
          messages: [{ role: "user", content: JSON.stringify(compactPromptItems) }],
        });

        const jsonMatch = copyRes.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx?: number; text?: string }>;
          for (const row of parsed) {
            if (typeof row.idx === "number" && typeof row.text === "string" && row.text.trim()) {
              generatedText.set(row.idx, row.text.trim());
            }
          }
        }
      } catch {
        // Keep clean deterministic fallback copy if worker hits rate limit
      }
    }

    const items: AiActionPlanItem[] = selectedBatch.map((c, idx) => {
      const text = generatedText.get(idx) ?? "";
      if (c.type === "product_desc") {
        return {
          id: `seo_prod_${c.id}`,
          title: c.name,
          subtitle: "Product Description",
          imageUrl: c.imageUrl,
          oldValueLabel: "Missing",
          newValueLabel: "Generated",
          detailText: text,
          mutation: {
            kind: "seo_product",
            productId: c.id,
            description: text,
          },
        };
      }
      if (c.type === "media_alt") {
        return {
          id: `seo_media_${c.mediaId}`,
          title: c.contextTitle,
          subtitle: `Image Alt Text (${c.mediaName})`,
          imageUrl: mediaUrl(c.mediaPath),
          oldValueLabel: "Empty alt",
          newValueLabel: "SEO alt",
          detailText: text,
          mutation: {
            kind: "seo_media_alt",
            mediaId: c.mediaId,
            alt: truncate(text, 125),
          },
        };
      }
      if (c.type === "post_seo") {
        const cleanMeta = truncate(text, 155);
        return {
          id: `seo_post_${c.id}`,
          title: c.title,
          subtitle: c.missingExcerpt ? "Blog Post Meta Description & Excerpt" : "Blog Post Meta Description",
          oldValueLabel: "Missing",
          newValueLabel: `${cleanMeta.length} chars`,
          detailText: cleanMeta,
          mutation: {
            kind: "seo_post",
            postId: c.id,
            seoDescription: cleanMeta,
            ...(c.missingExcerpt ? { excerpt: cleanMeta } : {}),
          },
        };
      }
      const cleanMeta = truncate(text, 155);
      return {
        id: `seo_page_${c.id}`,
        title: c.title,
        subtitle: "CMS Page Meta Description",
        oldValueLabel: "Missing",
        newValueLabel: `${cleanMeta.length} chars`,
        detailText: cleanMeta,
        mutation: {
          kind: "seo_page",
          pageId: c.id,
          seoDescription: cleanMeta,
        },
      };
    });

    const plan: AiActionPlan | undefined =
      items.length > 0
        ? {
            id: `plan_seo_${Date.now()}`,
            title: `SEO Audit Fixes — ${items.length} ${items.length === 1 ? "Improvement" : "Improvements"} Ready`,
            description:
              totalIssues > items.length
                ? `Found ${totalIssues} missing SEO fields across your store (showing first ${items.length}). Review and click Apply All.`
                : `Found ${totalIssues} missing SEO fields across products, pages, blog posts, and media.`,
            applyLabel: `Apply All (${items.length})`,
            items,
          }
        : undefined;

    return {
      toolOutputJson: JSON.stringify({
        totalIssuesFound: totalIssues,
        preparedFixesCount: items.length,
        status: items.length > 0 ? "seo_fixes_preview_ready" : "all_seo_fields_healthy",
        fixes: items.map((i) => ({
          target: i.title,
          field: i.subtitle,
          proposedText: i.detailText,
        })),
      }),
      badge: {
        id: call.id,
        name: call.name,
        summary: `audit_and_fix_seo(${scope}, ${totalIssues} found)`,
      },
      plan,
    };
  }

  /* 6. Preview Order Status Update */
  if (call.name === "preview_order_status_update") {
    const supabase = await createClient();
    const orderNum = Number(call.arguments.orderNumber);
    const newStatus = String(call.arguments.newStatus) as
      | "pending"
      | "processing"
      | "completed"
      | "cancelled";

    const { data: order } = await supabase
      .from("orders")
      .select("id, order_number, status, shipping_name, total_micros")
      .eq("order_number", orderNum)
      .maybeSingle();

    if (!order) {
      return {
        toolOutputJson: JSON.stringify({ error: `Order #${orderNum} not found.` }),
        badge: {
          id: call.id,
          name: call.name,
          summary: `preview_order_status_update(#${orderNum} not found)`,
        },
      };
    }

    const item: AiActionPlanItem = {
      id: `order_${order.id}`,
      title: `Order ${formatOrderNumber(order.order_number)} · ${order.shipping_name}`,
      subtitle: formatMoney(order.total_micros, money),
      oldValueLabel: order.status,
      newValueLabel: newStatus,
      mutation: {
        kind: "order_status",
        orderId: order.id,
        newStatus,
      },
    };

    const plan: AiActionPlan = {
      id: `plan_order_${Date.now()}`,
      title: `Update Order ${formatOrderNumber(order.order_number)} Status`,
      description: `Move order from "${order.status}" to "${newStatus}".`,
      applyLabel: "Apply Status Change",
      items: [item],
    };

    return {
      toolOutputJson: JSON.stringify({
        status: "preview_ready",
        orderNumber: formatOrderNumber(order.order_number),
        from: order.status,
        to: newStatus,
      }),
      badge: {
        id: call.id,
        name: call.name,
        summary: `preview_order_status_update(${formatOrderNumber(order.order_number)} -> ${newStatus})`,
      },
      plan,
    };
  }

  return {
    toolOutputJson: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
    badge: {
      id: call.id,
      name: call.name,
      summary: `${call.name}(unsupported)`,
    },
  };
}

/* ── Zero-Token Stateless Plan Executor ("Apply All") ────────────────────── */

export async function executeApprovedPlan(opts: {
  plan: AiActionPlan;
  selectedItemIds: string[];
}): Promise<{ appliedCount: number; errors: string[] }> {
  await assertAdmin();
  const supabase = await createClient();
  const selectedSet = new Set(opts.selectedItemIds);
  const chosenItems = opts.plan.items.filter((i) => selectedSet.has(i.id));

  let appliedCount = 0;
  const errors: string[] = [];
  let touchedPages = false;
  let touchedPosts = false;
  const pageSlugs: string[] = [];
  const postSlugs: string[] = [];

  for (const item of chosenItems) {
    const m = item.mutation;
    try {
      if (m.kind === "discount") {
        if (!UUID_RE.test(m.productId)) continue;
        const { error } = await supabase
          .from("products")
          .update({
            price_micros: Math.max(0, Math.round(m.newPriceMicros)),
            compare_at_price_micros:
              m.newCompareAtMicros !== null ? Math.max(0, Math.round(m.newCompareAtMicros)) : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.productId);
        if (error) throw new Error(error.message);

        for (const vu of m.variationUpdates ?? []) {
          if (!UUID_RE.test(vu.variationId)) continue;
          await supabase
            .from("product_variations")
            .update({
              price_micros: Math.max(0, Math.round(vu.newPriceMicros)),
              compare_at_price_micros:
                vu.newCompareAtMicros !== null
                  ? Math.max(0, Math.round(vu.newCompareAtMicros))
                  : null,
            })
            .eq("id", vu.variationId);
        }
        appliedCount++;
      } else if (m.kind === "product_status") {
        if (!UUID_RE.test(m.productId)) continue;
        const patch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (typeof m.isActive === "boolean") patch.is_active = m.isActive;
        if (typeof m.isFeatured === "boolean") patch.is_featured = m.isFeatured;
        const { error } = await supabase.from("products").update(patch).eq("id", m.productId);
        if (error) throw new Error(error.message);
        appliedCount++;
      } else if (m.kind === "seo_product") {
        if (!UUID_RE.test(m.productId)) continue;
        const { error } = await supabase
          .from("products")
          .update({
            description: m.description?.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.productId);
        if (error) throw new Error(error.message);
        appliedCount++;
      } else if (m.kind === "seo_media_alt") {
        if (!UUID_RE.test(m.mediaId)) continue;
        const { error } = await supabase
          .from("media")
          .update({
            alt: m.alt.trim().slice(0, 200),
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.mediaId);
        if (error) throw new Error(error.message);
        appliedCount++;
      } else if (m.kind === "seo_post") {
        if (!UUID_RE.test(m.postId)) continue;
        const patch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (m.seoTitle) patch.seo_title = m.seoTitle.trim().slice(0, 120);
        if (m.seoDescription) patch.seo_description = m.seoDescription.trim().slice(0, 200);
        if (m.excerpt) patch.excerpt = m.excerpt.trim().slice(0, 300);
        const { data: updated, error } = await supabase
          .from("blog_posts")
          .update(patch)
          .eq("id", m.postId)
          .select("slug")
          .maybeSingle();
        if (error) throw new Error(error.message);
        touchedPosts = true;
        if (updated?.slug) postSlugs.push(updated.slug);
        appliedCount++;
      } else if (m.kind === "seo_page") {
        if (!UUID_RE.test(m.pageId)) continue;
        const patch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (m.seoTitle) patch.seo_title = m.seoTitle.trim().slice(0, 120);
        if (m.seoDescription) patch.seo_description = m.seoDescription.trim().slice(0, 200);
        if (m.excerpt) patch.excerpt = m.excerpt.trim().slice(0, 300);
        const { data: updated, error } = await supabase
          .from("pages")
          .update(patch)
          .eq("id", m.pageId)
          .select("slug")
          .maybeSingle();
        if (error) throw new Error(error.message);
        touchedPages = true;
        if (updated?.slug) pageSlugs.push(updated.slug);
        appliedCount++;
      } else if (m.kind === "order_status") {
        if (!UUID_RE.test(m.orderId)) continue;
        const { error } = await supabase
          .from("orders")
          .update({
            status: m.newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.orderId);
        if (error) throw new Error(error.message);
        appliedCount++;
      }
    } catch (err) {
      errors.push(`${item.title}: ${err instanceof Error ? err.message : "Failed"}`);
    }
  }

  if (touchedPages) {
    expireTag(PAGES_TAG);
    for (const s of pageSlugs) expireTag(pageTag(s));
  }
  if (touchedPosts) {
    expireTag(POSTS_TAG);
    for (const s of postSlugs) expireTag(postTag(s));
  }
  if (appliedCount > 0) {
    revalidateStore();
  }

  return { appliedCount, errors };
}

import type { AiContentEntity } from "@/lib/ai/content-fields";
import type { AiProviderId } from "@/lib/ai/providers";

export type AiToolBadge = {
  id: string;
  name: string;
  summary: string;
};

export type AiDiscountMutation = {
  kind: "discount";
  productId: string;
  newPriceMicros: number;
  newCompareAtMicros: number | null;
  variationUpdates?: Array<{
    variationId: string;
    newPriceMicros: number;
    newCompareAtMicros: number | null;
  }>;
};

export type AiProductStatusMutation = {
  kind: "product_status";
  productId: string;
  isActive?: boolean;
  isFeatured?: boolean;
  newStock?: number;
  variationStockUpdates?: Array<{
    variationId: string;
    newStock: number;
  }>;
};

export type AiSeoFixMutation =
  | {
      kind: "seo_product";
      productId: string;
      description?: string;
    }
  | {
      kind: "seo_page";
      pageId: string;
      seoTitle?: string;
      seoDescription?: string;
      excerpt?: string;
    }
  | {
      kind: "seo_post";
      postId: string;
      seoTitle?: string;
      seoDescription?: string;
      excerpt?: string;
    }
  | {
      kind: "seo_media_alt";
      mediaId: string;
      alt: string;
    };

export type AiOrderStatusMutation = {
  kind: "order_status";
  orderId: string;
  newStatus: "pending" | "processing" | "completed" | "cancelled";
};

export type AiContentMutation = {
  kind: "content_update";
  entity: AiContentEntity;
  entityId: string;
  field: string;
  value: string;
  previousValue: string | null;
  previousUpdatedAt: string;
};

export type AiPlanMutation =
  | AiContentMutation
  | AiDiscountMutation
  | AiProductStatusMutation
  | AiSeoFixMutation
  | AiOrderStatusMutation;

export type AiActionPlanItem = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  oldValueLabel?: string;
  newValueLabel: string;
  stockBadge?: {
    label: string;
    tone: "emerald" | "amber" | "rose" | "neutral";
  };
  detailText?: string;
  mutation: AiPlanMutation;
};

export type AiActionPlan = {
  id: string;
  title: string;
  description: string;
  applyLabel: string;
  items: AiActionPlanItem[];
};

export type AiInventoryWidgetItem = {
  id: string;
  name: string;
  category: string | null;
  price: string;
  compareAtPrice?: string | null;
  stock: number;
  status: "active" | "draft";
  imageUrl?: string | null;
};

export type AiInventoryWidget = {
  id: string;
  kind: "inventory";
  title: string;
  matchedCount: number;
  attentionCount: number;
  items: AiInventoryWidgetItem[];
};

export type AiAnalyticsWidget = {
  id: string;
  kind: "analytics";
  windowDays: number;
  revenueWindow: string;
  ordersInWindow: number;
  revenue30d: string;
  revenueAllTime: string;
  ordersByStatus: {
    pending: number;
    processing: number;
    completed: number;
    cancelled: number;
  };
  catalogHealth: {
    totalProducts: number;
    activeProducts: number;
    draftProducts: number;
    activeOutOfStock: number;
    activeLowStockUpTo3: number;
  };
  topProducts: Array<{
    name: string;
    unitsSold: number;
    revenue: string;
  }>;
  pendingOrders: Array<{
    orderNumber: string;
    customer: string;
    total: string;
    paymentStatus: string;
    createdAt: string;
  }>;
};

export type AiSeoHealthyWidget = {
  id: string;
  kind: "seo_healthy";
  scope: string;
};

export type AiUiWidget =
  | AiInventoryWidget
  | AiAnalyticsWidget
  | AiSeoHealthyWidget;

export type AiChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AiAgentTurnResponse = {
  reply: string;
  toolBadges: AiToolBadge[];
  plans: AiActionPlan[];
  widgets?: AiUiWidget[];
  provider: AiProviderId;
  modelUsed: string;
  usedFallback: boolean;
  rateLimit: {
    limitTokensPerMin?: number | null;
    remainingTokensPerMin?: number | null;
    usedTokensThisTurn: number;
  };
};

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

export type AiPlanMutation =
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

export type AiChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AiAgentTurnResponse = {
  reply: string;
  toolBadges: AiToolBadge[];
  plans: AiActionPlan[];
  provider: AiProviderId;
  modelUsed: string;
  usedFallback: boolean;
  rateLimit: {
    limitTokensPerMin?: number | null;
    remainingTokensPerMin?: number | null;
    usedTokensThisTurn: number;
  };
};

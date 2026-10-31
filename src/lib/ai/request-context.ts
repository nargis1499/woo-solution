import type { AiSettingsServer } from "./providers";

export type AgentGroup = "inventory_intelligence" | "inventory_operations" | "store_analytics" | "pricing" | "content_seo" | "orders";

/** Exact small-talk allowlist, never a prefix match that could swallow a store action. */
export function isSimpleConversation(prompt: string): boolean {
  const text = prompt.toLowerCase().replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:hello|hi|hey|hello there|hi there|good morning|good afternoon|good evening|good night|how are you|hello how are you|hi how are you|thanks|thank you|thank you very much|thanks a lot|you are welcome|bye|goodbye|assalamualaikum|salam|হ্যালো|হাই|আসসালামু আলাইকুম|ধন্যবাদ|hola|bonjour)$/.test(text);
}

/** Unknown wording and context-dependent follow-ups keep the full agent workflow.
 * Multiple recognizable domains are unioned, not routed to a single winning domain.
 */
export function requestGroups(prompt: string): AgentGroup[] | null {
  if (isSimpleConversation(prompt)) return [];
  if (/\b(it|its|them|their|this|these|those|that|same|previous|above|again|instead|continue|also|here|current|selected|yes|no|apply|confirm|approve)\b/i.test(prompt)) return null;
  const groups = new Set<AgentGroup>();
  if (/\b(orders?|customers?|payments?|refunds?|shipments?|shipping|fulfill\w*|tracking|purchases?|buyers?|checkout|cancellations?)\b/i.test(prompt)) groups.add("orders");
  if (/\b(inventory|stock|restock\w*|reorder\w*|overstock\w*|depletion|sales spikes?|dead inventory)\b/i.test(prompt)) {
    groups.add("inventory_intelligence"); groups.add("inventory_operations");
  }
  if (/\b(discounts?|prices?|pricing|promotions?|sale prices?)\b/i.test(prompt)) { groups.add("pricing"); groups.add("inventory_operations"); }
  if (/\b(seo|content|descriptions?|pages?|posts?|blogs?|media|alt text|translate|translation|rewrite|rewriting|copy|titles?|brand|features|excerpts?)\b/i.test(prompt)) groups.add("content_seo");
  if (/\b(revenue|best[ -]selling|top[ -]selling|bestsellers?|aov|average order value)\b/i.test(prompt)) groups.add("orders");
  if (/\b(analytics|sales summary|sales report)\b/i.test(prompt)) { groups.add("store_analytics"); groups.add("orders"); }
  if (groups.size === 0 && /\b(products?|catalog|categories|category|sku)\b/i.test(prompt)) groups.add("inventory_operations");
  // Unsupported/other-domain requests must not be silently reduced to a known subtask.
  if (/\b(coupons?|tax|taxes|settings|theme|menus?|users?|password|plugins?|export|import|delete|remove|translate)\b/i.test(prompt) && !groups.has("content_seo")) return null;
  return groups.size ? [...groups] : null;
}

export function buildConversationPrompt(settings: Pick<AiSettingsServer, "default_language" | "brand_tone" | "system_instructions">): string {
  return [
    "You are Nemesis AI, a helpful store-management assistant. This turn is only a greeting or social exchange. Reply naturally and briefly; do not claim to have read store data or made changes.",
    `Respond in ${settings.default_language}. Tone: ${settings.brand_tone}.`,
    settings.system_instructions ? `Store custom instructions: ${settings.system_instructions}` : "",
  ].filter(Boolean).join("\n");
}

/** Keep recent user topics available for explicit multi-turn tasks without sending
 * unrelated schemas on a brand-new task. Social exchanges intentionally stand alone.
 */
export function routingPrompt(prompt: string, history: Array<{ role: string; content: string }> = []): string {
  if (isSimpleConversation(prompt)) return prompt;
  return [...history.slice(-4).filter(h => h.role === "user" && typeof h.content === "string" && !isSimpleConversation(h.content)).map(h => h.content.slice(0, 1000)), prompt].join("\n");
}

/** Positive read wording plus no mutation verb: unfamiliar phrasing keeps write tools. */
export function isExplicitReadRequest(prompt: string): boolean {
  return /^(?:please\s+)?(?:show|list|find|search|analy[sz]e|investigate|report|compare|calculate|which|what|how many|how much|give|tell|summari[sz]e|detect|identify)\b/i.test(prompt.trim())
    && !/\b(update|change|set|add|send|notify|cancel|refund|prepare|draft|publish|hide|restock|apply|mark|rewrite|generate|translate|remove|delete|fix)\b/i.test(prompt);
}

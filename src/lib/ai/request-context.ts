import type { AiSettingsServer } from "./providers";
import type { AiChatHistoryItem } from "./types";

export type AgentGroup = "inventory_intelligence" | "inventory_operations" | "store_analytics" | "pricing" | "content_seo" | "orders";
const REFERENCES = /\b(it|its|them|their|this|these|those|that|same|previous|above|again|instead|continue|also|here|current|selected|yes|no|apply|confirm|approve)\b/i;
const ELLIPTICAL = /^(?:and\b|what about\b|only\b|more\b|less\b|sort\b|filter\b|next\b|previous\b|(?:for\s+)?(?:last|past)\s+\d+\s+(?:days?|weeks?|months?)\b)/i;

/** Whole-message allowlist: decorative emoji/punctuation never hides extra task words. */
export function isSimpleConversation(prompt: string): boolean {
  const text = prompt.toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu, " ")
    .replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:hello|hi|hey|hello there|hi there|good morning|good afternoon|good evening|good night|how are you|hello how are you|hi how are you|thanks|thank you|thank you very much|thanks a lot|you are welcome|bye|goodbye|assalamualaikum|salam|হ্যালো|হাই|আসসালামু আলাইকুম|ধন্যবাদ|hola|bonjour)(?: (?:nemesis(?: ai)?|ai))?$/.test(text);
}

function detectGroups(prompt: string): AgentGroup[] | null {
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
  if (/\b(coupons?|tax|taxes|settings|theme|menus?|users?|password|plugins?|export|import|delete|remove|translate)\b/i.test(prompt) && !groups.has("content_seo")) return null;
  return groups.size ? [...groups] : null;
}

export function requestGroups(prompt: string): AgentGroup[] | null {
  if (isSimpleConversation(prompt)) return [];
  return REFERENCES.test(prompt) ? null : detectGroups(prompt);
}

export type RequestContext = {
  mode: "greeting" | "scoped" | "full";
  groups: AgentGroup[] | null;
  history: AiChatHistoryItem[];
  toolPrompt: string;
};

const sameGroups = (a: AgentGroup[], b: AgentGroup[]) => a.length === b.length && a.every(g => b.includes(g));
const FOLLOW_UP_WORDS = new Set("please same that this these those it them their its yes no again continue also apply confirm approve report reports filters filter scope period periods but and what about for only more less sort sorted ascending descending next previous page pages last past first top bottom by the a an with without in from to of on all day days week weeks month months year years today yesterday tomorrow paid unpaid pending processing completed cancelled refunded active draft high medium low priority priorities oldest newest recent quantity quantities amount amounts total totals name names date dates status statuses not do change anything".split(" "));
const canInheritWithoutDomain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).every(word => FOLLOW_UP_WORDS.has(word) || /^\d+$/.test(word));
const dependsOnHistory = (text: string) => REFERENCES.test(text) || ELLIPTICAL.test(text.trim());

/** Keep exact conversation content, not an AI-generated summary of IDs or proposed edits.
 * A new explicit topic doesn't inherit old topics. Uncertain dependencies fail open
 * to full context/tool coverage; this router is not an authorization mechanism.
 */
export function planRequestContext(prompt: string, rawHistory: AiChatHistoryItem[] = []): RequestContext {
  const history = rawHistory.filter(h => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string");
  if (isSimpleConversation(prompt)) return { mode: "greeting", groups: [], history: [], toolPrompt: prompt };
  const full = (): RequestContext => ({ mode: "full", groups: null, history, toolPrompt: prompt });
  const current = detectGroups(prompt);
  const followUp = dependsOnHistory(prompt);
  if (!current && !followUp) return full();

  if (followUp && !current && !canInheritWithoutDomain(prompt)) return full();
  let anchor = -1;
  const recentGroups = new Set<AgentGroup>();
  let parent: AgentGroup[] | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role !== "user" || isSimpleConversation(entry.content)) continue;
    if (dependsOnHistory(entry.content)) {
      const recent = detectGroups(entry.content);
      if (!recent && !canInheritWithoutDomain(entry.content)) {
        if (followUp) return full();
        break;
      }
      recent?.forEach(g => recentGroups.add(g));
      continue;
    }
    parent = detectGroups(entry.content);
    anchor = i;
    break;
  }
  if (parent) parent = [...new Set([...parent, ...recentGroups])];
  if (followUp && (anchor < 0 || !parent)) return full();
  // Don't use a known parent's tools to disguise an explicitly unsupported new request.
  if (followUp && !current && /\b(coupons?|tax|taxes|settings|theme|menus?|users?|password|plugins?|export|import|delete|remove|translate)\b/i.test(prompt)) return full();
  const groups = followUp ? [...new Set([...(parent ?? []), ...(current ?? [])])] : current!;
  if (!followUp && (!parent || !sameGroups(groups, parent))) return { mode: "scoped", groups, history: [], toolPrompt: prompt };

  let start = anchor;
  // Keep the contiguous current-topic conversation; stop at unrelated or unknown topics.
  for (let i = anchor - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role !== "user" || isSimpleConversation(entry.content)) continue;
    if (dependsOnHistory(entry.content)) { start = i; continue; }
    const older = detectGroups(entry.content);
    if (!older || !parent || !sameGroups(older, parent)) break;
    start = i;
  }
  return { mode: "scoped", groups, history: history.slice(start), toolPrompt: followUp ? `${history[anchor].content}\n${prompt}` : prompt };
}

export function routingPrompt(prompt: string, history: AiChatHistoryItem[] = []): string {
  return planRequestContext(prompt, history).toolPrompt;
}

export function buildConversationPrompt(settings: Pick<AiSettingsServer, "default_language" | "brand_tone" | "system_instructions">): string {
  return [
    "You are Nemesis AI, a helpful store-management assistant. Reply briefly to this greeting/social exchange. Do not claim store reads or changes.",
    `Language: ${settings.default_language}. Tone: ${settings.brand_tone}.`,
    settings.system_instructions ? `Store instructions: ${settings.system_instructions}` : "",
  ].filter(Boolean).join("\n");
}

export function isExplicitReadRequest(prompt: string): boolean {
  return /^(?:please\s+)?(?:show|list|find|search|analy[sz]e|investigate|report|compare|calculate|which|what|how many|how much|give|tell|summari[sz]e|detect|identify)\b/i.test(prompt.trim())
    && !/\b(update|change|set|add|send|notify|cancel|refund|prepare|draft|publish|hide|restock|apply|mark|rewrite|generate|translate|remove|delete|fix)\b/i.test(prompt);
}

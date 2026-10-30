// Shared allow-list: never accept arbitrary table names or columns from a model/client.
export const CONTENT_FIELDS = {
  product: { name: 200, description: 20000, brand: 200, features: 2000 },
  page: { title: 200, content: 50000, excerpt: 300, seo_title: 120, seo_description: 200, og_title: 120, og_description: 200 },
  post: { title: 200, content: 50000, excerpt: 300, seo_title: 120, seo_description: 200, og_title: 120, og_description: 200 },
  media: { alt: 200 },
} as const;

export type AiContentEntity = keyof typeof CONTENT_FIELDS;

export function isContentEntity(value: unknown): value is AiContentEntity {
  return typeof value === "string" && Object.hasOwn(CONTENT_FIELDS, value);
}

export function validateContentValue(entity: unknown, field: unknown, value: unknown): string {
  if (!isContentEntity(entity) || typeof field !== "string" || !Object.hasOwn(CONTENT_FIELDS[entity], field)) {
    throw new Error("Unsupported content field. Use a supported content tool; arbitrary database edits are not allowed.");
  }
  const max = (CONTENT_FIELDS[entity] as Record<string, number>)[field];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`Content must be non-empty text of at most ${max} characters.`);
  }
  return value.trim();
}

export function contentContextFromPath(path: unknown): string {
  if (typeof path !== "string") return "";
  const match = /^\/nemesis\/(products|pages|posts)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/edit)?\/?$/i.exec(path);
  if (!match) return "";
  const entity = { products: "product", pages: "page", posts: "post" }[match[1].toLowerCase()];
  return `Current admin editor: entity=${entity}, id=${match[2]}. For "this ${entity}" use this ID with query_content before generating a preview. Editor context takes precedence over older conversation targets. Read persisted data with tools; unsaved editor changes are not included.`;
}

// One bounded repair turn for models that draft store copy but forget the preview tool.
// Explicit advice/chat-only requests and clarification questions should remain conversational.
export function needsContentPreviewRepair(prompt: string, reply: string): boolean {
  return /\b(generate|write|rewrite|update|replace|improve|translate|shorten|lengthen|create|edit)\b/i.test(prompt)
    && /\b(description|copy|title|content|excerpt|alt|features|metadata|text)\b/i.test(prompt)
    && !/\b(don't|do not|no)\s+(save|apply|update|change|edit)\b|\b(chat.only|advice.only|example.only)\b/i.test(prompt)
    && reply.trim().length > 120
    && !reply.trim().endsWith("?");
}

export const CONTENT_PREVIEW_REPAIR = "The requested store copy needs an actionable approval preview, not only a chat draft. Read the exact target with query_content if necessary, then call preview_content_update using the complete proposed replacement. If the target is ambiguous, ask the admin to choose. Do not invent IDs, claim it was saved, or repeat the draft instead of creating a preview.";

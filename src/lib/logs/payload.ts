/** Shared browser/server sanitation. No headers or endpoint URLs are persisted. */
export const MAX_LOG_CHARS = 100_000;
export type LogPayload = {
  data: unknown;
  redacted: boolean;
  truncated: boolean;
};
export function sanitizeLogPayload(
  value: unknown,
  secrets: string[] = [],
): LogPayload {
  let redacted = false;
  let truncated = false;
  let budget = MAX_LOG_CHARS;
  const text = (input: string) => {
    let out = input;
    for (const secret of secrets.filter((s) => s.length > 0)) {
      if (out.includes(secret)) {
        out = out.split(secret).join("[REDACTED]");
        redacted = true;
      }
    }
    out = out.replace(
      /\bBearer\s+[\w.\-~+/=]+|\b(?:sk-|sk_)[\w-]{12,}|\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|\bAIza[\w-]{20,}|[A-Z0-9._%+-]{1,128}@[A-Z0-9.-]{1,128}\.[A-Z]{2,24}/gi,
      () => {
        redacted = true;
        return "[REDACTED]";
      },
    );
    out = out.replace(
      /((?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[=:]\s*)[^\s,;"}]+/gi,
      "$1[REDACTED]",
    );
    if (out !== input) redacted = true;
    if (out.length > budget) {
      out = out.slice(0, Math.max(0, budget)) + " [TRUNCATED]";
      truncated = true;
    }
    budget -= out.length;
    return out;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 16) {
      truncated = true;
      return "[TRUNCATED]";
    }
    if (typeof v === "string") {
      // Tool arguments/results are frequently JSON encoded inside strings.
      if (/^\s*[\[{]/.test(v)) {
        try {
          return JSON.stringify(walk(JSON.parse(v), depth + 1));
        } catch {
          /* ordinary text */
        }
      }
      return text(v);
    }
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      budget -= 10;
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length > 500) truncated = true;
      return v.slice(0, 500).map((x) => walk(x, depth + 1));
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > 200) truncated = true;
      return Object.fromEntries(
        entries.slice(0, 200).map(([k, x]) => {
          budget -= k.length + 5;
          if (
            /^(?:authorization|cookie|set-cookie|.*api[_-]?key|password|secret|private_key|.*access[_-]?token|refresh_token|customer_email|email|phone|phone_number|address|billing_address|shipping_address|transaction_hash|card_number|cvv)$/i.test(
              k,
            )
          ) {
            redacted = true;
            return [k, "[REDACTED]"];
          }
          return [text(k), walk(x, depth + 1)];
        }),
      );
    }
    return null;
  };
  const data = walk(value, 0);
  // JSON escaping and many structural elements can exceed the text budget.
  if (new TextEncoder().encode(JSON.stringify(data)).length > 240_000)
    return {
      data: "[TRUNCATED: payload exceeded safe storage limit]",
      redacted,
      truncated: true,
    };
  return { data, redacted, truncated };
}
export function reportedTokens(value: unknown): {
  input: number | null;
  output: number | null;
} {
  const v = value as Record<string, unknown> | null;
  const u = (v?.usage ?? v?.usageMetadata ?? {}) as Record<string, unknown>;
  const num = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  const input = num(
    u.prompt_tokens ??
      u.input_tokens ??
      u.promptTokenCount ??
      v?.prompt_eval_count,
  );
  const output = num(
    u.completion_tokens ??
      u.output_tokens ??
      u.candidatesTokenCount ??
      v?.eval_count,
  );
  return {
    input:
      input == null
        ? null
        : input +
          (num(u.cache_creation_input_tokens) ?? 0) +
          (num(u.cache_read_input_tokens) ?? 0),
    output: output == null ? null : output + (num(u.thoughtsTokenCount) ?? 0),
  };
}

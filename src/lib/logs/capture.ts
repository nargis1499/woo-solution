import { reportedTokens, sanitizeLogPayload, type LogPayload } from "./payload";
export type LogMeta = {
  trace_id: string;
  provider: string;
  model: string;
  source: "server" | "worker" | "browser";
};
export type LogStart = LogMeta & { request_payload: LogPayload };
export type LogFinish = {
  status: "success" | "error";
  http_status: number | null;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  response_payload: LogPayload;
};
export type LogSink = {
  start: (entry: LogStart) => Promise<string | null>;
  finish: (id: string, entry: LogFinish) => Promise<void>;
};

/** Bound clone reads; the original provider response is never consumed or modified. */
export async function readLimitedBody(
  response: Response,
  limit = 250_000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new Error("Body exceeds diagnostic size limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export function capturingAiFetch(
  meta: LogMeta,
  sink: LogSink,
  secrets: string[] = [],
): typeof fetch {
  return async (url, init) => {
    let payload: unknown = init?.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        /* non-JSON */
      }
    }
    let id: string | null = null;
    try {
      id = await sink.start({
        ...meta,
        request_payload: sanitizeLogPayload(payload, secrets),
      });
    } catch {
      console.warn("AI diagnostic start unavailable");
    }
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (id) {
        try {
          await sink.finish(id, {
            status: "error",
            http_status: null,
            duration_ms: Date.now() - started,
            input_tokens: null,
            output_tokens: null,
            response_payload: sanitizeLogPayload(
              "Network request failed; provider usage unavailable",
            ),
          });
        } catch {
          console.warn("AI diagnostic finish unavailable");
        }
      }
      throw error;
    }
    if (id) {
      let body: unknown;
      try {
        const raw = await readLimitedBody(response.clone());
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } catch {
        body = {
          diagnostic_note:
            "Response body unavailable or exceeded capture limit; original response unaffected",
        };
      }
      const counts = reportedTokens(body);
      try {
        await sink.finish(id, {
          status: response.ok ? "success" : "error",
          http_status: response.status,
          duration_ms: Date.now() - started,
          input_tokens: counts.input,
          output_tokens: counts.output,
          response_payload: sanitizeLogPayload(body, secrets),
        });
      } catch {
        console.warn("AI diagnostic finish unavailable");
      }
    }
    return response;
  };
}

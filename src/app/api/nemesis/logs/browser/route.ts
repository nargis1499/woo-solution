import { NextResponse } from "next/server";
import { assertAdmin, AdminAuthError } from "@/lib/admin/auth";
import { readLimitedBody } from "@/lib/logs/capture";
import { sanitizeLogPayload } from "@/lib/logs/payload";
import { diagnosticLogSink } from "@/lib/logs/server";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export async function POST(request: Request) {
  try {
    await assertAdmin();
    const origin = request.headers.get("origin");
    if (
      origin &&
      origin !== new URL(request.url).origin &&
      new URL(origin).host !== request.headers.get("host")
    )
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const body = JSON.parse(
      await readLimitedBody(new Response(request.body), 350_000),
    );
    // Re-sanitize client data; preserve capture flags without nesting payload envelopes.
    const payload = sanitizeLogPayload(body.payload?.data);
    payload.redacted = payload.redacted || body.payload?.redacted === true;
    payload.truncated = payload.truncated || body.payload?.truncated === true;
    if (
      body.phase === "start" &&
      uuid(body.trace_id) &&
      typeof body.model === "string"
    ) {
      const id = await diagnosticLogSink.start({
        trace_id: body.trace_id,
        provider: "ollama",
        model: body.model.slice(0, 200),
        source: "browser",
        request_payload: payload,
      });
      return NextResponse.json({ id });
    }
    if (body.phase === "finish" && uuid(body.id)) {
      const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
        typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max
          ? v
          : null;
      await diagnosticLogSink.finish(body.id, {
        status: body.status === "success" ? "success" : "error",
        http_status: num(body.http_status, 599),
        duration_ms: num(body.duration_ms, 2147483647) ?? 0,
        input_tokens: num(body.input_tokens),
        output_tokens: num(body.output_tokens),
        response_payload: payload,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid log payload" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AdminAuthError
            ? "Administrator access required"
            : "Unable to record browser diagnostic",
      },
      { status: error instanceof AdminAuthError ? 403 : 400 },
    );
  }
}

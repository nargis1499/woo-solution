import { getAdminStatus } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { subscribeOrderChat } from "@/lib/order-chat-bus";
import { listOrderMessagesSince } from "@/lib/order-messages";
import type { OrderMessage } from "@/lib/types";

/**
 * GET /api/orders/[id]/chat/stream — Server-Sent Events feed of one order's thread.
 *
 * On connect the stream replays everything written after `?since=<ISO>` (the message the
 * page was rendered with), then pushes every new message of that order to the open tab.
 * Delivery is driven by the in-process bus the POST route publishes to, with a database
 * poll behind it: when a message was stored by another instance – or a broadcast was lost
 * while the connection re-established – the poll still picks it up.
 *
 * Customers only ever reach their own order (RLS), admins every order.
 */

type Params = { params: Promise<{ id: string }> };

/** How long a stream may sit idle before it re-reads the table (missed broadcasts). */
const POLL_MS = 2000;
/** Comment frames keep proxies from dropping an idle connection. */
const PING_MS = 20000;

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;

  const { user } = await getAdminStatus();
  if (!user) return Response.json({ error: "Sign in to open this thread." }, { status: 401 });

  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("id").eq("id", id).maybeSingle();
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });

  const since = new URL(request.url).searchParams.get("since");
  const encoder = new TextEncoder();

  // Ids already written to this stream: bus, catch-up and poll overlap on purpose.
  const sent = new Set<string>();
  let cursor: string | null = since;
  let lastWrite = Date.now();

  let end = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let wake: (() => void) | null = null;
      let unsubscribe = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
          lastWrite = Date.now();
        } catch {
          closed = true; // the client went away between two writes
        }
      };

      const send = (message: OrderMessage) => {
        if (sent.has(message.id)) return;
        sent.add(message.id);
        cursor = message.created_at;
        write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      };

      const close = () => {
        if (closed) return;
        closed = true;
        wake?.();
        unsubscribe();
        if (ping) clearInterval(ping);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // the runtime closed it first
        }
      };
      end = close;

      unsubscribe = subscribeOrderChat(id, (message) => {
        send(message);
        wake?.();
      });
      ping = setInterval(() => {
        if (!closed && Date.now() - lastWrite >= PING_MS) write(": ping\n\n");
      }, PING_MS);
      request.signal.addEventListener("abort", close);

      // 3 s before the browser retries a dropped connection
      write("retry: 3000\n\n");

      void (async () => {
        while (!closed) {
          try {
            for (const message of await listOrderMessagesSince(id, cursor)) send(message);
          } catch {
            // table missing / database hiccup: hold the connection, try again next tick
          }

          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, POLL_MS);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
        }
      })().catch(close);
    },
    cancel() {
      end();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

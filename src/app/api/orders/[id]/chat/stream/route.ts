import { getAdminStatus } from "@/lib/admin/auth";
import { createClient } from "@/lib/supabase/server";
import { subscribeOrderChat } from "@/lib/order-chat-bus";
import { listOrderMessagesSince } from "@/lib/order-messages";
import { getPersonPresence, getStorePresence } from "@/lib/presence.server";
import { presenceStatus, type Presence } from "@/lib/presence";
import type { OrderMessage } from "@/lib/types";

/**
 * GET /api/orders/[id]/chat/stream — Server-Sent Events feed of one order's thread.
 *
 * Events:
 *   message   – a stored message (replayed for everything after `?since=`, then live)
 *   receipt   – the recipient stamped messages delivered / seen → ✓ / ✓✓ on the sender's side
 *   presence  – the other side's "Online" / "Last seen …" state, polled every 8 s and
 *               pushed whenever it changes. For a customer it is the *filtered* view of
 *               the store staff (`store_presence_for()`, resolved against *this*
 *               customer's override), so an admin who keeps themselves offline never
 *               leaks an activity time through this channel either.
 *
 * Delivery is driven by the in-process bus the POST routes publish to, with a database
 * poll behind it: a message stored by another instance – or a broadcast lost while the
 * connection re-established – still arrives.
 */

type Params = { params: Promise<{ id: string }> };

/** How long a stream may sit idle before it re-reads the table (missed broadcasts). */
const POLL_MS = 2000;
/** Presence is computed from the freshest database values this often. */
const PRESENCE_EVERY = 4; // × POLL_MS = 8 s
/** Comment frames keep proxies from dropping an idle connection. */
const PING_MS = 20000;

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;

  const { user, isAdmin } = await getAdminStatus();
  if (!user) return Response.json({ error: "Sign in to open this thread." }, { status: 401 });

  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("id, user_id").eq("id", id).maybeSingle();
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
  const customerId = (order as { user_id: string | null }).user_id;

  const since = new URL(request.url).searchParams.get("since");
  const encoder = new TextEncoder();

  // Ids already written to this stream: bus, catch-up and poll overlap on purpose.
  const sent = new Set<string>();
  const receipts = new Map<string, { delivered: string | null; seen: string | null }>();
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

      const sendMessage = (message: OrderMessage) => {
        if (sent.has(message.id)) return;
        sent.add(message.id);
        receipts.set(message.id, { delivered: message.delivered_at ?? null, seen: message.seen_at ?? null });
        cursor = message.created_at;
        write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      };

      const sendReceipt = (ids: string[], status: "delivered" | "seen", at: string) => {
        if (ids.length === 0) return;
        for (const msgId of ids) {
          const prev = receipts.get(msgId) ?? { delivered: null, seen: null };
          receipts.set(msgId, {
            delivered: prev.delivered ?? at,
            seen: status === "seen" ? at : prev.seen,
          });
        }
        write(`event: receipt\ndata: ${JSON.stringify({ ids, status, at })}\n\n`);
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

      unsubscribe = subscribeOrderChat(id, (event) => {
        if (event.type === "message") sendMessage(event.message);
        else if (event.type === "receipt") sendReceipt(event.ids, event.status, event.at);
        else write(`event: presence\ndata: ${JSON.stringify(event.presence)}\n\n`);
        wake?.();
      });
      ping = setInterval(() => {
        if (!closed && Date.now() - lastWrite >= PING_MS) write(": ping\n\n");
      }, PING_MS);
      request.signal.addEventListener("abort", close);

      // 3 s before the browser retries a dropped connection
      write("retry: 3000\n\n");

      /** The counterpart's presence, already filtered for this viewer. */
      const readPresence = async (): Promise<Presence> => {
        if (isAdmin) {
          if (!customerId) return { online: false, lastActiveAt: null };
          const person = await getPersonPresence(customerId, supabase);
          return { online: presenceStatus(person.lastActiveAt) === "online", lastActiveAt: person.lastActiveAt };
        }
        // resolved for this customer: their per-customer override, else the global switch
        const store = await getStorePresence(user.id, supabase);
        return { online: store.online, lastActiveAt: store.lastActiveAt, visibility: store.visibility };
      };

      void (async () => {
        let tick = 0;
        let lastPresence = "";
        while (!closed) {
          try {
            const allMessages = await listOrderMessagesSince(id, null, supabase);
            for (const message of allMessages) {
              const deliv = message.delivered_at ?? null;
              const seen = message.seen_at ?? null;
              if (!sent.has(message.id)) {
                if (since && message.created_at <= since) {
                  // Already in the client's initialMessages; seed its baseline and emit any new receipt.
                  sent.add(message.id);
                  receipts.set(message.id, { delivered: deliv, seen });
                  if (seen) sendReceipt([message.id], "seen", seen);
                  else if (deliv) sendReceipt([message.id], "delivered", deliv);
                } else {
                  sendMessage(message);
                }
                continue;
              }
              const prev = receipts.get(message.id) ?? { delivered: null, seen: null };
              if (seen && prev.seen !== seen) {
                sendReceipt([message.id], "seen", seen);
              } else if (deliv && prev.delivered !== deliv) {
                sendReceipt([message.id], "delivered", deliv);
              }
            }
          } catch {
            // table missing / database hiccup: hold the connection, try again next tick
          }

          if (tick % PRESENCE_EVERY === 0) {
            try {
              const presence = await readPresence();
              const fingerprint = JSON.stringify(presence);
              if (fingerprint !== lastPresence) {
                lastPresence = fingerprint;
                write(`event: presence\ndata: ${fingerprint}\n\n`);
              }
            } catch {
              // presence is best-effort – the thread keeps streaming
            }
          }
          tick += 1;

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

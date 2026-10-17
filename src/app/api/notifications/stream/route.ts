import { getAdminStatus } from "@/lib/admin/auth";
import { getNotificationPreview, getUnreadNotificationCount, listNotificationsSince } from "@/lib/notifications.server";
import { subscribeNotifications } from "@/lib/notification-bus";
import type { AppNotification } from "@/lib/notifications";

/**
 * GET /api/notifications/stream — one SSE connection per signed-in tab, both roles.
 *
 * Events
 *   snapshot     { items, unread }   on connect (and after a reconnect): the popover state
 *   notification <AppNotification>   a new row, pushed within ~2 s of being written
 *   unread       { unread }          whenever the badge count changed
 *   refresh      (no data)           another tab marked read / deleted → re-read the preview
 *
 * Delivery: the rows are written by database triggers (orders, order_messages), so the
 * loop reads `created_at > cursor` on an index every 2 s. That is server-side work the
 * browser never sees – the client keeps exactly one EventSource open. `retry: 3000`
 * plus EventSource's own reconnection covers dropped connections, and a `: ping`
 * comment every 20 s keeps proxies from closing an idle stream.
 */

const POLL_MS = 2000;
const PING_MS = 20000;
const COUNT_EVERY = 2; // × POLL_MS = the badge is re-checked every 4 s (and on every nudge)

export async function GET(request: Request) {
  const { user } = await getAdminStatus();
  if (!user) return Response.json({ error: "Sign in to receive notifications." }, { status: 401 });

  const userId = user.id;
  const encoder = new TextEncoder();
  let end = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let wake: (() => void) | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;
      let lastWrite = Date.now();
      let cursor: string | null = null;
      let unread = -1;
      let tick = 0;
      const sent = new Set<string>();

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
          lastWrite = Date.now();
        } catch {
          closed = true; // the client went away between two writes
        }
      };

      const sendEvent = (event: string, data?: unknown) =>
        write(data === undefined ? `event: ${event}\ndata: {}\n\n` : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const pushNotification = (item: AppNotification) => {
        if (sent.has(item.id)) return;
        sent.add(item.id);
        if (!cursor || item.created_at > cursor) cursor = item.created_at;
        sendEvent("notification", item);
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

      const unsubscribe = subscribeNotifications(userId, () => {
        // another tab of this user marked read / deleted → re-read on the next tick at once
        tick = 0;
        wake?.();
      });

      ping = setInterval(() => {
        if (!closed && Date.now() - lastWrite >= PING_MS) write(": ping\n\n");
      }, PING_MS);
      request.signal.addEventListener("abort", close);

      write("retry: 3000\n\n");

      void (async () => {
        // First frame: what the header should show right now (also heals a reconnect).
        try {
          const preview = await getNotificationPreview(20);
          for (const item of preview.items) sent.add(item.id);
          if (preview.items.length > 0) cursor = preview.items[0].created_at;
          unread = preview.unread;
          sendEvent("snapshot", preview);
        } catch {
          // the bell keeps the server-rendered state
        }

        while (!closed) {
          if (tick % COUNT_EVERY === 0) {
            try {
              const next = await getUnreadNotificationCount();
              if (next !== unread) {
                unread = next;
                sendEvent("unread", { unread });
              }
            } catch {
              // count is best-effort – the stream keeps going
            }
          }

          try {
            for (const item of await listNotificationsSince(cursor)) pushNotification(item);
          } catch {
            // table missing / database hiccup: hold the connection, try again next tick
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

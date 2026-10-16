"use client";

import { useEffect, useRef, useState } from "react";
import { SendIcon, ShieldCheckIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CLOSED_THREAD_MESSAGE, MAX_ORDER_MESSAGE_LENGTH, isOrderChatOpen, orderChatTurn, sortOrderMessages, type OrderChatViewer } from "@/lib/order-chat";
import { cn } from "@/lib/utils";
import type { OrderMessage, OrderStatus } from "@/lib/types";

/**
 * The order inquiry thread — the same component for the customer (/orders/[id]) and the
 * admin (/nemesis/orders/[id]); `viewer` decides whose bubble is which, the rules are
 * identical for both. New messages arrive over SSE (`/api/orders/[id]/chat/stream`), the
 * POST route is the only writer, and it re-checks every rule the UI shows.
 *
 * Admin messages sit on the left, customer messages on the right – in both views.
 */
export function OrderChat({
  orderId,
  status,
  viewer,
  initialMessages,
  customerName,
}: {
  orderId: string;
  status: OrderStatus;
  viewer: OrderChatViewer;
  initialMessages: OrderMessage[];
  /** Shown as the author of the customer's bubbles (their profile name / the shipping name). */
  customerName?: string | null;
}) {
  const [messages, setMessages] = useState<OrderMessage[]>(() => sortOrderMessages(initialMessages));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const list = useRef<HTMLUListElement | null>(null);
  // Only used to build the stream URL once: everything after this timestamp is replayed on connect.
  const since = useRef(initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].created_at : "");

  useEffect(() => {
    const source = new EventSource(`/api/orders/${orderId}/chat/stream${since.current ? `?since=${encodeURIComponent(since.current)}` : ""}`);
    source.addEventListener("open", () => setLive(true));
    source.addEventListener("message", (event) => {
      let incoming: OrderMessage;
      try {
        incoming = JSON.parse((event as MessageEvent<string>).data) as OrderMessage;
      } catch {
        return;
      }
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : sortOrderMessages([...prev, incoming])));
    });
    // EventSource reconnects on its own (the stream sends `retry:`); the dot just reflects it.
    source.addEventListener("error", () => setLive(false));
    return () => source.close();
  }, [orderId]);

  // Keep the newest bubble in view as the thread grows. Only the list scrolls – scrolling the
  // page here would jump the whole order page down the moment it loads.
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const open = isOrderChatOpen(status);
  const turn = orderChatTurn(messages, viewer);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_ORDER_MESSAGE_LENGTH;
  const canSend = open && turn.canSend && trimmed.length > 0 && !tooLong && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: OrderMessage; error?: string } | null;
      if (!response.ok || !payload?.message) {
        setError(payload?.error ?? "The message could not be sent. Please try again.");
        return;
      }
      const saved = payload.message;
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : sortOrderMessages([...prev, saved])));
      setDraft("");
    } catch {
      setError("The message could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card data-testid="order-chat">
      <CardHeader>
        <CardTitle>Order inquiries</CardTitle>
        <CardAction>
          <span
            className={cn("mt-1.5 block size-2 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")}
            data-testid="order-chat-live"
            data-live={live ? "true" : "false"}
            title={live ? "Live updates on" : "Reconnecting…"}
            aria-label={live ? "Live updates on" : "Reconnecting"}
            role="status"
          />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="order-chat-empty">
            No messages yet.
          </p>
        ) : (
          <ul ref={list} className="max-h-96 space-y-3 overflow-y-auto pr-1" data-testid="order-chat-messages">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} customerName={customerName} />
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3 border-t">
        {!open ? (
          <p className="text-sm text-muted-foreground" data-testid="order-chat-closed">
            {CLOSED_THREAD_MESSAGE}
          </p>
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <div className="relative min-w-0 flex-1">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={!turn.canSend || sending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  aria-label={viewer === "admin" ? "Reply to the customer" : "Your message"}
                  placeholder="Write a message…"
                  className="min-h-20 pb-7 pr-20"
                  data-testid="order-chat-input"
                />
                <span
                  className={cn("pointer-events-none absolute right-3 bottom-2 text-xs tabular-nums", tooLong ? "font-medium text-destructive" : "text-muted-foreground")}
                  data-testid="order-chat-counter"
                >
                  {trimmed.length} / {MAX_ORDER_MESSAGE_LENGTH}
                </span>
              </div>
              <Button type="button" onPress={send} isDisabled={!canSend} className="self-stretch" data-testid="order-chat-send">
                <SendIcon /> {viewer === "admin" ? "Reply" : "Send"}
              </Button>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="order-chat-error">
                {error}
              </p>
            )}

            <p className="text-xs text-muted-foreground" data-testid="order-chat-note">
              {tooLong ? `Please shorten the message to ${MAX_ORDER_MESSAGE_LENGTH} characters.` : turn.note}
            </p>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function MessageBubble({ message, customerName }: { message: OrderMessage; customerName?: string | null }) {
  const isAdmin = message.sender_type === "admin";
  const name = isAdmin ? "Admin" : (message.sender_name || customerName || "Customer");
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  const at = new Date(message.created_at).toLocaleString();

  return (
    <li
      className={cn("flex items-start gap-2", !isAdmin && "flex-row-reverse")}
      data-testid={`order-chat-message-${message.sender_type}`}
      data-message-id={message.id}
      aria-label={`${name}, ${at}`}
    >
      {isAdmin ? (
        // The official store badge instead of a personal picture.
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" data-testid="order-chat-admin-badge" title="Store admin" aria-hidden>
          <ShieldCheckIcon className="size-4" />
        </span>
      ) : (
        <Avatar>
          {message.sender_avatar_url && <AvatarImage src={message.sender_avatar_url} alt="" />}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm break-words",
          isAdmin ? "rounded-tl-sm bg-primary text-primary-foreground" : "rounded-tr-sm bg-muted",
        )}
      >
        <p className={cn("text-xs font-semibold", isAdmin ? "text-primary-foreground/90" : "text-muted-foreground")}>{name}</p>
        <p className="mt-0.5 whitespace-pre-wrap">{message.message}</p>
      </div>
    </li>
  );
}

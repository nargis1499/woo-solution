"use client";

import { relativeTime } from "@/lib/notifications";

/**
 * "5m ago" / "3h ago" / "12 Mar". The value depends on the reader's clock, which the
 * server cannot know, so the element opts out of the hydration comparison for its own
 * text (React keeps the server string until the first client render) – the same trick
 * as the chat's `LocalTime`. The `title` holds the full timestamp.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning className={className} title={Number.isNaN(date.getTime()) ? undefined : date.toLocaleString("en-US")}>
      {relativeTime(iso)}
    </time>
  );
}

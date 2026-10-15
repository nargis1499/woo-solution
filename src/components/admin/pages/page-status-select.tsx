"use client";

import { useOptimistic, useTransition } from "react";
import { setPageStatus } from "@/app/nemesis/pages/actions";
import { PAGE_STATUSES } from "@/lib/pages/shared";
import type { PageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Inline Draft / Published dropdown in the pages list. The change is sent to
 * the server right away (`setPageStatus` → redirect back with a toast); the
 * control shows the new value optimistically and is disabled until the server
 * answered, so what you see is what is stored.
 */
export function PageStatusSelect({ id, status, title, returnTo }: { id: string; status: PageStatus; title: string; returnTo: string }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(status);

  return (
    <Select
      aria-label={`Status of "${title}"`}
      selectedKey={optimistic}
      isDisabled={pending}
      onSelectionChange={(key) => {
        const next = key as PageStatus;
        if (!next || next === optimistic) return;
        startTransition(async () => {
          setOptimistic(next);
          const formData = new FormData();
          formData.set("id", id);
          formData.set("status", next);
          formData.set("return_to", returnTo);
          await setPageStatus(formData);
        });
      }}
      data-testid="page-status-select"
      data-status={optimistic}
    >
      <SelectTrigger size="sm" className={cn("h-8 min-w-32 gap-1.5", optimistic === "published" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" : "text-muted-foreground")} aria-busy={pending}>
        <span className={cn("size-2 shrink-0 rounded-full", optimistic === "published" ? "bg-emerald-500" : "bg-muted-foreground/50")} aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAGE_STATUSES.map((s) => (
          <SelectItem key={s.id} id={s.id}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

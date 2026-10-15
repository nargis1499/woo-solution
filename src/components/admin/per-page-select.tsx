"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Key } from "react-aria-components";
import { PER_PAGE_COOKIE, PER_PAGE_OPTIONS, listHref, pageForNewSize } from "@/lib/admin/pagination";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * "Per page" dropdown. Changing it navigates to the page that still contains
 * the first row currently on screen (so page number and page size never drift
 * apart) and remembers the choice in a cookie for the next visit.
 */
export function PerPageSelect({
  pathname,
  params,
  page,
  perPage,
  options = PER_PAGE_OPTIONS,
  cookieName = PER_PAGE_COOKIE,
  label = "Per page",
}: {
  pathname: string;
  params: Record<string, string | undefined>;
  page: number;
  perPage: number;
  /** Page sizes offered (tables: 10/20/50/100, media grid: 12/24/48/96). */
  options?: readonly number[];
  cookieName?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Shows the new value immediately; settles on the server-resolved value once the new page renders.
  const [shownPerPage, setShownPerPage] = useOptimistic(perPage);

  function onSelectionChange(key: Key | null) {
    const next = Number(key);
    if (!next || next === perPage) return;
    document.cookie = `${cookieName}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      setShownPerPage(next);
      router.push(listHref(pathname, { ...params, per: next, page: pageForNewSize(page, perPage, next) }));
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="per" className="text-muted-foreground">
        {label}
      </Label>
      <Select name="per" aria-label={label} selectedKey={String(shownPerPage)} onSelectionChange={onSelectionChange} isDisabled={pending}>
        <SelectTrigger id="per" className="w-20" aria-busy={pending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((n) => (
            <SelectItem key={n} id={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PER_PAGE_COOKIE, PER_PAGE_OPTIONS, listHref, pageForNewSize } from "@/lib/admin/pagination";

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
}: {
  pathname: string;
  params: Record<string, string | undefined>;
  page: number;
  perPage: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Shows the new value immediately; settles on the server-resolved value once the new page renders.
  const [shownPerPage, setShownPerPage] = useOptimistic(perPage);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = Number(event.target.value);
    if (next === perPage) return;
    document.cookie = `${PER_PAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      setShownPerPage(next);
      router.push(listHref(pathname, { ...params, per: next, page: pageForNewSize(page, perPage, next) }));
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-neutral-600">
      <span>Per page</span>
      <select
        name="per"
        value={shownPerPage}
        onChange={onChange}
        disabled={pending}
        aria-busy={pending}
        className="input-base h-9 w-auto py-0 pr-8"
      >
        {PER_PAGE_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

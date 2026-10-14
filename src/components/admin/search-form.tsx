import Link from "next/link";
import type { ReactNode } from "react";
import { SearchIcon } from "@/components/icons";

/** Plain GET form – works without JS and keeps the URL shareable. */
export function SearchForm({
  action,
  q,
  placeholder = "Search…",
  children,
  isFiltered,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  children?: ReactNode;
  isFiltered?: boolean;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input-base w-56 pl-9 sm:w-72"
        />
      </div>
      {children}
      <button type="submit" className="h-10 rounded-lg border border-neutral-300 bg-surface px-4 text-sm font-medium hover:bg-neutral-100">
        Filter
      </button>
      {isFiltered && (
        <Link href={action} className="text-sm text-neutral-500 hover:text-neutral-900">
          Clear
        </Link>
      )}
    </form>
  );
}

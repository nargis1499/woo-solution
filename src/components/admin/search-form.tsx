import Link from "next/link";
import type { ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/** Plain GET form – works without JS and keeps the URL shareable. */
export function SearchForm({
  action,
  q,
  placeholder = "Search…",
  children,
  isFiltered,
  hidden,
  clearHref = action,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  children?: ReactNode;
  isFiltered?: boolean;
  /** Extra params to keep while filtering (e.g. the page size). A new filter always starts on page 1. */
  hidden?: Record<string, string | number | undefined>;
  clearHref?: string;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {hidden &&
        Object.entries(hidden).map(([name, value]) =>
          value === undefined || value === "" ? null : <input key={name} type="hidden" name={name} value={String(value)} />,
        )}
      <InputGroup className="w-56 sm:w-72">
        <InputGroupInput type="search" name="q" defaultValue={q ?? ""} placeholder={placeholder} aria-label={placeholder} />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      {children}
      <Button type="submit" variant="outline">
        Filter
      </Button>
      {isFiltered && (
        <Link href={clearHref} className={buttonVariants({ variant: "ghost" })}>
          Clear
        </Link>
      )}
    </form>
  );
}

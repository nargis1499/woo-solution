import Link from "next/link";
import type { MenuLink } from "@/lib/menu";

/** One storefront navigation link: internal targets get the Next.js link (prefetch, client navigation), external ones a plain anchor. */
export function NavLink({ item, className }: { item: MenuLink; className?: string }) {
  const target = item.newTab ? "_blank" : undefined;
  const rel = item.newTab || item.external ? "noreferrer" : undefined;
  if (item.external) {
    return (
      <a href={item.href} target={target} rel={rel} className={className}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} target={target} rel={rel} className={className}>
      {item.label}
    </Link>
  );
}

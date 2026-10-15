"use client";

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";

export type Crumb = { label: string; href?: string };

/** Breadcrumb trail from data (the React Aria collection is built client-side – see data-grid.tsx). */
export function PageBreadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {items.map((item, i) => (
          <BreadcrumbItem key={`${item.label}-${i}`} id={`${item.label}-${i}`}>
            {item.href && i < items.length - 1 ? <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink> : <BreadcrumbPage>{item.label}</BreadcrumbPage>}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

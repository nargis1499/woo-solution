import { PackageSearchIcon } from "lucide-react";
import type { Product } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getSiteSettings } from "@/lib/site-settings";
import { ProductCard } from "./product-card";

export async function ProductGrid({
  products,
  emptyMessage = "No products found.",
  manageStock,
}: {
  products: Product[];
  emptyMessage?: string;
  manageStock?: boolean;
}) {
  if (products.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageSearchIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>{emptyMessage}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const resolvedManageStock = manageStock ?? (await getSiteSettings()).manage_stock;
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product, i) => (
        <ProductCard
          key={product.id}
          product={product}
          priority={i < 3}
          manageStock={resolvedManageStock}
        />
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="gap-0 overflow-hidden rounded-2xl py-0">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-4 w-1/4 rounded-md" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <div className="flex items-center justify-between pt-3">
              <Skeleton className="h-6 w-20" />
              <div className="flex gap-2">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-9 w-20 rounded-xl" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

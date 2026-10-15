import Link from "next/link";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AddToCartButton } from "./add-to-cart-button";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function ProductCard({ product, priority, manageStock = true }: { product: Product; priority?: boolean; manageStock?: boolean }) {
  const onSale = product.compare_at_price_cents != null && product.compare_at_price_cents > product.price_cents;

  return (
    <Card className="group gap-0 overflow-hidden py-0 transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <Link href={`/products/${product.slug}`} className="relative block" aria-label={product.name}>
        <ProductImage src={product.image_url} alt={product.name} priority={priority} className="transition-transform duration-500 group-hover:scale-[1.03]" />
        {onSale && <Badge className="absolute top-3 left-3">Sale</Badge>}
        {manageStock && product.stock <= 0 && (
          <Badge variant="secondary" className="absolute top-3 right-3">
            Sold out
          </Badge>
        )}
      </Link>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        {product.category && (
          <Link href={`/shop?category=${product.category.slug}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-primary">
            {product.category.name}
          </Link>
        )}
        <h3 className="line-clamp-2 leading-snug font-medium">
          <Link href={`/products/${product.slug}`} className="hover:text-primary">
            {product.name}
          </Link>
        </h3>
        <Price cents={product.price_cents} compareAtCents={product.compare_at_price_cents} className="mt-auto" />
        <AddToCartButton product={product} size="sm" className="mt-2 w-full" manageStock={manageStock} />
      </CardContent>
    </Card>
  );
}

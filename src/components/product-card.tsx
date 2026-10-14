import Link from "next/link";
import type { Product } from "@/lib/types";
import { AddToCartButton } from "./add-to-cart-button";
import { Price } from "./price";
import { ProductImage } from "./product-image";

export function ProductCard({ product, priority }: { product: Product; priority?: boolean }) {
  const onSale = product.compare_at_price_cents != null && product.compare_at_price_cents > product.price_cents;

  return (
    <article className="card group flex flex-col overflow-hidden transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <Link href={`/products/${product.slug}`} className="relative block">
        <ProductImage src={product.image_url} alt={product.name} priority={priority} className="transition-transform duration-500 group-hover:scale-[1.03]" />
        {onSale && (
          <span className="absolute left-3 top-3 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">
            Sale
          </span>
        )}
        {product.stock <= 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-neutral-900/80 px-2.5 py-1 text-xs font-semibold text-neutral-50">
            Sold out
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.category && (
          <Link
            href={`/shop?category=${product.category.slug}`}
            className="text-xs font-medium uppercase tracking-wide text-neutral-500 hover:text-brand-700 dark:hover:text-brand-300"
          >
            {product.category.name}
          </Link>
        )}
        <h3 className="line-clamp-2 font-medium leading-snug text-neutral-900">
          <Link href={`/products/${product.slug}`} className="hover:text-brand-700 dark:hover:text-brand-300">
            {product.name}
          </Link>
        </h3>
        <Price cents={product.price_cents} compareAtCents={product.compare_at_price_cents} className="mt-auto" />
        <AddToCartButton product={product} size="sm" className="mt-2 w-full" />
      </div>
    </article>
  );
}

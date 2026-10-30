"use client";

import { useState } from "react";
import { ScanSearchIcon } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { WishlistButton } from "@/components/wishlist-button";
import type { GallerySlide } from "@/lib/media/shared";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProductGallery({ slides, className, product }: { slides: GallerySlide[]; className?: string; product?: Product }) {
  const [index, setIndex] = useState(0);
  const current = slides[Math.min(index, Math.max(0, slides.length - 1))] ?? null;

  return (
    <div className={cn("space-y-3", className)} data-testid="product-gallery">
      <div className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/20">
        <ProductImage
          src={current?.src ?? null}
          alt={current?.alt || product?.name || "Product image"}
          sizes="(min-width: 1024px) 48vw, 100vw"
          priority
          className="aspect-[16/10] max-h-[21rem] bg-slate-900 sm:max-h-[23rem] lg:max-h-[24rem]"
          imageClassName="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        />
        {product && (
          <WishlistButton
            product={product}
            className="absolute right-3.5 top-3.5 z-10 size-10 rounded-full border-white/15 bg-slate-950/75 text-white shadow-lg backdrop-blur hover:bg-slate-800"
          />
        )}
        <div className="pointer-events-none absolute bottom-3.5 left-3.5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/75 px-3 py-1.5 text-xs font-medium text-slate-100 opacity-90 backdrop-blur">
          <ScanSearchIcon className="size-3.5 text-indigo-300" /> Hover to zoom
        </div>
      </div>
      {slides.length > 1 && (
        <ul className="scrollbar-hidden flex gap-2.5 overflow-x-auto pb-1" aria-label="More pictures">
          {slides.map((slide, i) => (
            <li key={`${slide.src}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show picture ${i + 1} of ${slides.length}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "block h-14 w-20 overflow-hidden rounded-xl border transition sm:h-15 sm:w-24",
                  i === index ? "border-indigo-400 ring-2 ring-indigo-500/35" : "border-slate-700 opacity-75 hover:border-slate-500 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.thumb}
                  alt={slide.alt || (product?.name ? `${product.name} – image ${i + 1}` : "")}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

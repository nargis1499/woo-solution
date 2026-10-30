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
    <div className={cn("space-y-4", className)} data-testid="product-gallery">
      <div className="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/20">
        <ProductImage src={current?.src ?? null} alt={current?.alt ?? ""} sizes="(min-width: 1024px) 50vw, 100vw" priority className="aspect-square bg-slate-900" imageClassName="object-cover transition-transform duration-700 ease-out group-hover:scale-110" />
        {product && <WishlistButton product={product} className="absolute right-4 top-4 z-10 size-11 rounded-full border-white/15 bg-slate-950/75 text-white shadow-lg backdrop-blur hover:bg-slate-800" />}
        <div className="pointer-events-none absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/75 px-3 py-2 text-xs font-medium text-slate-100 opacity-90 backdrop-blur">
          <ScanSearchIcon className="size-4 text-indigo-300" /> Hover to zoom
        </div>
      </div>
      {slides.length > 1 && (
        <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="More pictures">
          {slides.map((slide, i) => (
            <li key={`${slide.src}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show picture ${i + 1} of ${slides.length}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "block size-[4.5rem] overflow-hidden rounded-xl border transition sm:size-20",
                  i === index ? "border-indigo-400 ring-2 ring-indigo-500/35" : "border-slate-700 opacity-75 hover:border-slate-500 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.thumb} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

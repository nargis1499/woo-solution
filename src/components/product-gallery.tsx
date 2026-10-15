"use client";

import { useState } from "react";
import { ProductImage } from "@/components/product-image";
import type { GallerySlide } from "@/lib/media/shared";
import { cn } from "@/lib/utils";

export function ProductGallery({ slides, className }: { slides: GallerySlide[]; className?: string }) {
  const [index, setIndex] = useState(0);
  const current = slides[Math.min(index, Math.max(0, slides.length - 1))] ?? null;

  return (
    <div className={cn("space-y-3", className)} data-testid="product-gallery">
      <ProductImage src={current?.src ?? null} alt={current?.alt ?? ""} sizes="(min-width: 1024px) 50vw, 100vw" priority className="rounded-2xl ring-1 ring-foreground/10" />
      {slides.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="More pictures">
          {slides.map((s, i) => (
            <li key={`${s.src}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show picture ${i + 1} of ${slides.length}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "block size-16 overflow-hidden rounded-lg ring-1 ring-foreground/10 transition-[box-shadow,opacity] sm:size-20",
                  i === index ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.thumb} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

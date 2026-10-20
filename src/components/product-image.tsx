"use client";

import { useState } from "react";
import Image from "next/image";
import { PackageIcon } from "lucide-react";
import { canOptimizeImage } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";

export function ProductImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw",
  priority,
  className,
}: {
  src: string | null;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const trimmedSrc = src?.trim() || null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasValidImage = Boolean(trimmedSrc && failedSrc !== trimmedSrc);

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden bg-muted", className)}>
      {hasValidImage && trimmedSrc ? (
        <Image
          src={trimmedSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          onError={() => setFailedSrc(trimmedSrc)}
          // Custom image URLs from the admin dashboard can point anywhere – serve
          // those as-is instead of failing the optimizer's host allow-list.
          unoptimized={!canOptimizeImage(trimmedSrc)}
        />
      ) : (
        <div
          data-testid="product-fallback-image"
          className="grid h-full w-full place-items-center bg-gradient-to-br from-primary/15 via-primary/5 to-muted text-primary/75"
        >
          <PackageIcon
            className="h-[48%] w-[48%] max-h-14 max-w-14 min-h-5 min-w-5"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

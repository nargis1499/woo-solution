import { ShoppingBagIcon, SparklesIcon, TagIcon } from "lucide-react";
import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The three icons a category without a picture falls back to, cycled by position:
 * icon1, icon2, icon3, icon1, icon2 …
 */
const FALLBACK_ICONS = [ShoppingBagIcon, TagIcon, SparklesIcon] as const;

/** Public URL of the category picture (library file first, then the stored URL). */
export function categoryImageUrl(category: Pick<Category, "image_url" | "image_media">): string | null {
  const media = category.image_media;
  if (media) return mediaPreviewUrl(media, "medium") ?? mediaUrl(media.path);
  return category.image_url || null;
}

/**
 * The round category picture — or, when the category has none, a round tile
 * filled with a gradient of the theme's primary colour and one of three
 * fallback icons.
 */
export function CategoryThumb({
  category,
  index = 0,
  size = "md",
  className,
}: {
  category: Pick<Category, "name" | "image_url" | "image_media">;
  /** Position in the list – picks the fallback icon. */
  index?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const src = categoryImageUrl(category);
  const Icon = FALLBACK_ICONS[index % FALLBACK_ICONS.length];

  return (
    <span
      data-testid="category-thumb"
      data-has-image={src ? "true" : "false"}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-border/60",
        size === "sm" && "size-8",
        size === "md" && "size-20 sm:size-24",
        size === "lg" && "size-24 sm:size-28",
        className,
      )}
    >
      {src ? (
        // Category pictures come from the Media Library or any URL an admin pasted —
        // a plain <img> keeps that host-agnostic (next/image needs an allow-list).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={category.name} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center bg-linear-to-br from-primary via-primary to-primary/40 text-primary-foreground">
          <Icon className={cn(size === "sm" ? "size-4" : size === "lg" ? "size-10" : "size-8")} aria-hidden />
        </span>
      )}
    </span>
  );
}

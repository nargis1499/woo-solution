import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import { CATEGORY_ICON_BY_ID, DEFAULT_CATEGORY_ICONS } from "@/lib/category-icons";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Public URL of the category picture (library file first, then the stored URL). */
export function categoryImageUrl(category: Pick<Category, "image_url" | "image_media">): string | null {
  const media = category.image_media;
  if (media) return mediaPreviewUrl(media, "medium") ?? mediaUrl(media.path);
  return category.image_url || null;
}

/**
 * The round category picture — or, when the category has none, a round tile
 * filled with a gradient of the theme's primary colour and the icon the admin
 * picked (the 1 → 2 → 3 defaults when none was picked).
 */
export function CategoryThumb({
  category,
  index = 0,
  size = "md",
  className,
}: {
  category: Pick<Category, "name" | "image_url" | "image_media" | "icon">;
  /** Position in the list – picks the fallback icon. */
  index?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const src = categoryImageUrl(category);
  // The icon the admin picked; without one, the 1 → 2 → 3 rotation by position.
  const Icon =
    (category.icon && CATEGORY_ICON_BY_ID[category.icon]) ||
    DEFAULT_CATEGORY_ICONS[index % DEFAULT_CATEGORY_ICONS.length];

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

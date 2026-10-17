import { mediaPreviewUrl, mediaUrl } from "@/lib/media/shared";
import { CATEGORY_ICON_BY_ID, DEFAULT_CATEGORY_ICON } from "@/lib/category-icons";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Public URL of the category picture (library file first, then the stored URL).
 * `prefer` picks the rendition: thumbnails for the admin list, `large` for a card.
 */
export function categoryImageUrl(
  category: Pick<Category, "image_url" | "image_media">,
  prefer: "thumbnail" | "medium" | "large" = "medium",
): string | null {
  const media = category.image_media;
  if (media) return mediaPreviewUrl(media, prefer) ?? mediaUrl(media.path);
  return category.image_url || null;
}

/** `#rrggbb` → the gradient an icon tile is filled with. */
export function iconGradientStyle(color: string | null | undefined): React.CSSProperties {
  if (!color) return {};
  return { backgroundImage: `linear-gradient(135deg, ${color}, ${color}, ${color}66)` };
}

/** Black or white icon for a custom fill, whichever reads better. */
function iconForeground(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return undefined;
  const value = parseInt(m[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#111111" : "#ffffff";
}

/**
 * The round category picture — or, when the category has none, a round tile
 * filled with the icon the admin picked (a shopping bag when nothing was
 * picked) on their colour, falling back to a gradient of the theme's primary.
 */
export function CategoryThumb({
  category,
  size = "md",
  className,
}: {
  category: Pick<Category, "name" | "image_url" | "image_media" | "icon" | "icon_color">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const src = categoryImageUrl(category);
  const Icon = (category.icon && CATEGORY_ICON_BY_ID[category.icon]) || DEFAULT_CATEGORY_ICON;
  const custom = Boolean(category.icon_color);

  return (
    <span
      data-testid="category-thumb"
      data-has-image={src ? "true" : "false"}
      data-has-color={custom ? "true" : "false"}
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
        <span
          className={cn(
            "grid size-full place-items-center text-primary-foreground",
            !custom && "bg-linear-to-br from-primary via-primary to-primary/40",
          )}
          style={{ ...iconGradientStyle(category.icon_color), color: iconForeground(category.icon_color) }}
        >
          <Icon className={cn(size === "sm" ? "size-4" : size === "lg" ? "size-10" : "size-8")} aria-hidden />
        </span>
      )}
    </span>
  );
}

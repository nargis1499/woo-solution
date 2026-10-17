import Link from "next/link";
import { CATEGORY_ICON_BY_ID, DEFAULT_CATEGORY_ICON } from "@/lib/category-icons";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { categoryImageUrl } from "./category-thumb";

/** White or near-black glyph for a custom fill, whichever reads better. */
function onFill(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? "#111111" : "#ffffff";
}

/** The badge behind a category icon: the admin's fill, else the theme primary. */
function badgeStyle(color: string | null | undefined): React.CSSProperties {
  if (!color) return {};
  return { backgroundImage: `linear-gradient(135deg, ${color}, ${color}cc)`, color: onFill(color) };
}

/**
 * A "Shop by category" card. Three shapes, picked by what the admin gave it:
 *
 *   icon only  → icon badge + name, and an oversized watermark of the same
 *                glyph tinted with the theme primary on the right;
 *   image only → the picture in the round badge, plain card, no watermark;
 *   both       → the picture fills the card behind a scrim, the icon sits in
 *                the badge, the name turns white.
 */
export function CategoryCard({ category }: { category: Category }) {
  const photo = categoryImageUrl(category, "large");
  const chosenIcon = category.icon ? CATEGORY_ICON_BY_ID[category.icon] : null;
  const Icon = chosenIcon ?? DEFAULT_CATEGORY_ICON;
  const variant: "icon" | "image" | "both" = !photo ? "icon" : chosenIcon ? "both" : "image";

  return (
    <Link
      href={`/shop?category=${category.slug}`}
      data-testid="home-category-tile"
      data-variant={variant}
      className={cn(
        "group relative flex h-20 items-center gap-2.5 overflow-hidden rounded-2xl border px-2.5 shadow-xs transition-all duration-200",
        "outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
        variant === "both"
          ? "border-transparent"
          : "border-border/70 bg-card hover:border-primary/40",
      )}
    >
      {/* ── backdrop ─────────────────────────────────────────────────────── */}
      {variant === "icon" && (
        <>
          {/* a wash of the theme primary so the card never looks flat */}
          <span
            className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/12 via-transparent to-primary/5 transition-opacity duration-200 group-hover:opacity-80"
            aria-hidden
          />
          {/* the oversized "shadow" glyph, cropped by the card edge */}
          <Icon
            className="pointer-events-none absolute top-1/2 right-1 size-16 -translate-y-1/2 text-primary/15 transition-transform duration-500 group-hover:scale-110"
            strokeWidth={1.5}
            aria-hidden
          />
        </>
      )}

      {variant === "both" && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-chosen URL, any host */}
          <img
            src={photo!}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <span
            className="absolute inset-0 bg-linear-to-r from-black/80 via-black/45 to-black/5"
            aria-hidden
          />
        </>
      )}

      {/* ── badge ────────────────────────────────────────────────────────── */}
      <span
        className={cn(
          "relative z-10 grid size-10 shrink-0 place-items-center overflow-hidden rounded-full",
          "shadow-sm ring-1 ring-black/10 transition-transform duration-200 group-hover:scale-105",
          variant === "image" && "ring-2 ring-border",
          variant !== "image" && !category.icon_color && "bg-linear-to-br from-primary via-primary to-primary/70 text-primary-foreground",
        )}
        style={variant === "image" ? undefined : badgeStyle(category.icon_color)}
        data-testid="category-card-badge"
      >
        {variant === "image" ? (
          // the badge crops the picture where the subject usually is (right of centre)
          // eslint-disable-next-line @next/next/no-img-element -- same, any host
          <img src={photo!} alt={category.name} loading="lazy" className="size-full object-cover object-[72%_center]" />
        ) : (
          <Icon className="size-5" aria-hidden />
        )}
      </span>

      {/* ── name ─────────────────────────────────────────────────────────── */}
      <span
        className={cn(
          "relative z-10 line-clamp-2 min-w-0 text-xs leading-tight font-semibold tracking-tight sm:text-[13px] xl:text-sm",
          variant === "both" ? "text-white drop-shadow-sm" : "text-foreground",
        )}
      >
        {category.name}
      </span>
    </Link>
  );
}

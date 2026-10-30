import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRightIcon,
  Gamepad2Icon,
  HeadphonesIcon,
  LaptopIcon,
  SmartphoneIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ICON_BY_ID, DEFAULT_CATEGORY_ICON } from "@/lib/category-icons";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import { getCategories, getProducts } from "@/lib/data/products";
import { FREE_SHIPPING_THRESHOLD_MICROS } from "@/lib/config";
import {
  DEFAULT_HOME_HERO_PRIMARY_CTA_HREF,
  DEFAULT_HOME_HERO_SECONDARY_CTA_HREF,
  defaultHomeHeroSubtitle,
  defaultHomeHeroTitle,
  resolveHomeCategorySections,
} from "@/lib/home-sections";
import { getSiteSettings } from "@/lib/site-settings";
import { canonicalFor } from "@/lib/seo";
import { formatMoney, moneyFromSettings } from "@/lib/money";
import type { Category, HomeCategoryBannerStyle } from "@/lib/types";
import { CategoryCard } from "@/components/category-card";
import { HomeProductFilter } from "@/components/home-product-filter";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-grid";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { alternates: await canonicalFor("/") };
}

function resolveCategorySectionIcon(category: Category): LucideIcon {
  if (category.icon && CATEGORY_ICON_BY_ID[category.icon]) {
    return CATEGORY_ICON_BY_ID[category.icon];
  }
  const slug = category.slug.toLowerCase();
  if (slug.includes("laptop") || slug.includes("computer")) return LaptopIcon;
  if (slug.includes("mobile") || slug.includes("phone")) return SmartphoneIcon;
  if (slug.includes("electr") || slug.includes("audio")) return HeadphonesIcon;
  if (slug.includes("gam") || slug.includes("access")) return Gamepad2Icon;
  return DEFAULT_CATEGORY_ICON;
}

function resolveCategorySubtitle(category: Category): string {
  const slug = category.slug.toLowerCase();
  if (slug.includes("electr") || slug.includes("audio")) {
    return "Audio, wearables, smart gadgets, and high-tech accessories";
  }
  if (slug.includes("laptop") || slug.includes("computer")) {
    return "High-performance ultrabooks, gaming laptops, and creator workstations";
  }
  if (slug.includes("mobile") || slug.includes("phone")) {
    return "Flagship 5G smartphones, foldable devices, and pro camera phones";
  }
  if (slug.includes("gam") || slug.includes("access")) {
    return "Mechanical keyboards, pro gaming mice, 4K monitors, and high-speed storage";
  }
  return `Explore our curated selection of ${category.name.toLowerCase()} products and essentials`;
}

function bannerStyleTokens(style: HomeCategoryBannerStyle) {
  switch (style) {
    case "dark-gradient":
      return {
        wrapper:
          "rounded-2xl border border-zinc-800 bg-linear-to-r from-zinc-950 via-zinc-900 to-primary/35 px-5 py-4 text-white shadow-sm before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-primary sm:px-6",
        iconBadge: "bg-primary text-primary-foreground shadow-sm",
        title: "text-white hover:text-white/85",
        subtitle: "text-zinc-300",
        countPill: "bg-white/15 text-white",
        sectionPill: "bg-white/12 text-white hover:bg-white/20",
      };
    case "primary-gradient":
      return {
        wrapper:
          "theme-hero rounded-2xl border border-primary/25 px-5 py-4 shadow-sm sm:px-6",
        iconBadge: "bg-white/20 text-primary-foreground backdrop-blur-xs",
        title: "text-primary-foreground hover:opacity-90",
        subtitle: "text-primary-foreground/80",
        countPill: "bg-white/20 text-primary-foreground",
        sectionPill: "bg-white/20 text-primary-foreground hover:bg-white/30",
      };
    case "glass":
      return {
        wrapper:
          "rounded-2xl border border-border/80 bg-card/85 px-5 py-4 shadow-xs backdrop-blur-md before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-primary sm:px-6",
        iconBadge: "bg-primary/15 text-primary",
        title: "text-foreground hover:text-primary",
        subtitle: "text-muted-foreground",
        countPill: "bg-primary/12 text-primary",
        sectionPill: "border border-border bg-muted/60 text-foreground hover:bg-muted",
      };
    case "minimal":
      return {
        wrapper: "border-b-2 border-primary/25 px-1 pb-4",
        iconBadge: "bg-primary text-primary-foreground shadow-xs",
        title: "text-foreground hover:text-primary",
        subtitle: "text-muted-foreground",
        countPill: "bg-primary/15 text-primary",
        sectionPill: "bg-primary/12 text-primary hover:bg-primary/20",
      };
    case "soft":
    default:
      return {
        wrapper:
          "rounded-2xl border border-primary/15 bg-primary/[0.06] px-5 py-4 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-primary sm:px-6",
        iconBadge: "bg-primary text-primary-foreground shadow-xs",
        title: "text-foreground hover:text-primary",
        subtitle: "text-muted-foreground",
        countPill: "bg-primary/15 text-primary",
        sectionPill: "bg-primary/12 text-primary hover:bg-primary/20",
      };
  }
}

/**
 * Hero + the sections switched on under UI → Home page. `getSiteSettings()` is cached and
 * tagged, so the choice of sections and hero copy is part of the static shell and flips the
 * moment an admin saves; the product/category sections themselves stream in.
 */
export default async function HomePage() {
  const settings = await getSiteSettings();
  const { store_name } = settings;
  const heroTitle = settings.home_hero_title || defaultHomeHeroTitle(store_name);
  const heroSubtitle =
    settings.home_hero_subtitle ||
    defaultHomeHeroSubtitle(
      formatMoney(FREE_SHIPPING_THRESHOLD_MICROS, moneyFromSettings(settings)),
    );
  const primaryCtaText = settings.home_hero_primary_cta_text;
  const primaryCtaHref = settings.home_hero_primary_cta_href || DEFAULT_HOME_HERO_PRIMARY_CTA_HREF;
  const secondaryCtaText = settings.home_hero_secondary_cta_text;
  const secondaryCtaHref =
    settings.home_hero_secondary_cta_href || DEFAULT_HOME_HERO_SECONDARY_CTA_HREF;

  return (
    <div className="container-page space-y-14 py-10">
      {/* Dynamic Hero section – configured under UI → Home page */}
      {settings.home_show_hero && (
        <section
          className="theme-hero relative overflow-hidden rounded-2xl px-6 py-16 sm:px-12 sm:py-24"
          data-testid="home-hero"
        >
          <div
            className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-32 left-1/3 size-96 rounded-full bg-black/10 blur-3xl"
            aria-hidden
          />
          {settings.home_hero_badge && (
            <Badge
              variant="secondary"
              data-testid="home-hero-badge"
              className="mb-4 bg-white/15 text-primary-foreground hover:bg-white/15"
            >
              <SparklesIcon /> {settings.home_hero_badge}
            </Badge>
          )}
          <h1
            data-testid="home-hero-title"
            className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl"
          >
            {heroTitle}
          </h1>
          <p
            data-testid="home-hero-subtitle"
            className="mt-4 max-w-xl text-lg text-primary-foreground/80"
          >
            {heroSubtitle}
          </p>
          {(primaryCtaText || secondaryCtaText) && (
            <div className="mt-8 flex flex-wrap gap-3">
              {primaryCtaText && (
                <Link
                  href={primaryCtaHref}
                  data-testid="home-hero-primary-cta"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "bg-background text-foreground hover:bg-background/90",
                  )}
                >
                  {primaryCtaText}
                </Link>
              )}
              {secondaryCtaText && (
                <Link
                  href={secondaryCtaHref}
                  data-testid="home-hero-secondary-cta"
                  className={cn(
                    buttonVariants({ size: "lg", variant: "ghost" }),
                    "text-primary-foreground hover:bg-white/10 hover:text-primary-foreground",
                  )}
                >
                  {secondaryCtaText} <ArrowRightIcon />
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {/* Categories – reads from Supabase → streams in */}
      {settings.home_show_categories && (
        <section aria-labelledby="home-categories" data-testid="home-categories">
          <h2 id="home-categories" className="mb-5 text-2xl font-bold tracking-tight">
            Shop by category
          </h2>
          <Suspense fallback={<CategoryTilesSkeleton />}>
            <CategoryTiles />
          </Suspense>
        </section>
      )}

      {/* Featured products */}
      {settings.home_show_featured && (
        <Suspense fallback={null}>
          <FeaturedProducts />
        </Suspense>
      )}

      {/* Products organized by dedicated category sections */}
      {settings.home_show_category_sections && (
        <Suspense fallback={<ProductGridSkeleton count={6} />}>
          <CategoryProductSections />
        </Suspense>
      )}

      {/* Filtered products – the shop's category filter, heading set by the admin */}
      {settings.home_show_filter && (
        <section
          aria-label={settings.home_filter_title ?? "Products"}
          data-testid="home-filter"
          className="scroll-mt-24"
        >
          {settings.home_filter_title && (
            <h2 className="mb-5 text-2xl font-bold tracking-tight">
              {settings.home_filter_title}
            </h2>
          )}
          <Suspense fallback={<ProductGridSkeleton count={6} />}>
            <FilteredProducts />
          </Suspense>
        </section>
      )}
    </div>
  );
}

async function CategoryProductSections() {
  const [categories, products, settings] = await Promise.all([
    getCategories(),
    getProducts(),
    getSiteSettings(),
  ]);

  const orderedConfigs = resolveHomeCategorySections(
    categories,
    settings.home_category_sections,
    settings.home_category_default_layout,
    settings.home_category_banner_style,
  );

  const sections = orderedConfigs
    .filter((cfg) => cfg.enabled)
    .map((cfg) => {
      const allMatching = products.filter(
        (p) => p.category_id === cfg.category.id || p.category?.slug === cfg.category.slug,
      );
      const items = cfg.limit > 0 ? allMatching.slice(0, cfg.limit) : allMatching;
      return {
        ...cfg,
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className="space-y-14" data-testid="home-category-sections">
      {sections.map(({ category, items, layout, banner_style }) => {
        const Icon = resolveCategorySectionIcon(category);
        const effectiveBannerStyle = banner_style ?? settings.home_category_banner_style;
        const tokens = bannerStyleTokens(effectiveBannerStyle);

        return (
          <section
            key={category.id}
            aria-labelledby={`home-cat-sec-${category.slug}`}
            data-testid={`home-category-section-${category.slug}`}
            data-layout={layout}
            className="scroll-mt-20 space-y-6"
          >
            {/* Dedicated Category Section Header Banner */}
            <div
              data-testid={`home-category-banner-${category.slug}`}
              data-banner-style={effectiveBannerStyle}
              className={cn(
                "relative flex flex-wrap items-center justify-between gap-4 overflow-hidden",
                tokens.wrapper,
              )}
            >
              <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-full",
                    tokens.iconBadge,
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2
                      id={`home-cat-sec-${category.slug}`}
                      className="text-xl font-extrabold tracking-tight sm:text-2xl"
                    >
                      <Link
                        href={`/shop?category=${category.slug}`}
                        className={cn("transition-colors", tokens.title)}
                      >
                        {category.name}
                      </Link>
                    </h2>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        tokens.countPill,
                      )}
                    >
                      {items.length} {items.length === 1 ? "Item" : "Items"}
                    </span>
                  </div>
                  <p className={cn("mt-0.5 truncate text-xs sm:text-sm", tokens.subtitle)}>
                    {resolveCategorySubtitle(category)}
                  </p>
                </div>
              </div>

              <Link
                href={`/shop?category=${category.slug}`}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-3.5 py-1 text-[11px] font-bold tracking-widest uppercase transition-colors",
                  tokens.sectionPill,
                )}
              >
                VIEW ALL
              </Link>
            </div>

            <ProductGrid
              products={items}
              manageStock={settings.manage_stock}
              layout={layout}
            />
          </section>
        );
      })}
    </div>
  );
}

async function FilteredProducts() {
  const [categories, products, { manage_stock }, canEdit] = await Promise.all([
    getCategories(),
    getProducts(),
    getSiteSettings(),
    isCurrentUserAdmin(),
  ]);
  return (
    <HomeProductFilter
      categories={categories}
      products={products}
      manageStock={manage_stock}
      canEdit={canEdit}
    />
  );
}

async function CategoryTiles() {
  const categories = await getCategories();
  if (categories.length === 0) return null;
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      data-testid="home-category-grid"
    >
      {categories.map((c) => (
        <CategoryCard key={c.id} category={c} />
      ))}
    </div>
  );
}

function CategoryTilesSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      aria-hidden
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  );
}

async function FeaturedProducts() {
  const products = await getProducts({ featuredOnly: true, limit: 6 });
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="home-featured" data-testid="home-featured">
      <div className="mb-5 flex items-end justify-between">
        <h2 id="home-featured" className="text-2xl font-bold tracking-tight">
          Featured products
        </h2>
        <Link href="/shop" className={buttonVariants({ variant: "link" })}>
          View all <ArrowRightIcon />
        </Link>
      </div>
      <ProductGrid products={products} />
    </section>
  );
}

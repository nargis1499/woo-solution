import type { ThemeColors, ThemeGradients } from "@/lib/theme";
import type { CurrencyCode } from "@/lib/money";
// Hand-written row types that mirror `supabase/migrations/*_init.sql`.
// Tip: once your schema grows, generate them instead:
//   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts

export type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  /** Only present in admin queries (`products(count)`). */
  product_count?: number;
};

/* ── Menus (UI → Menu) ───────────────────────────────────────────────────── */

export type MenuLocation = "header" | "footer";
export type MenuItemKind = "page" | "category" | "custom";

export type MenuItem = {
  id: string;
  location: MenuLocation;
  kind: MenuItemKind;
  /** Display text – defaults to the page / category name, editable afterwards. */
  title: string;
  page_id: string | null;
  category_id: string | null;
  /** Custom links only: `/path`, `https://…`, `mailto:` or `tel:`. */
  url: string | null;
  open_in_new_tab: boolean;
  sort_order: number;
  /** Embedded targets (admin queries). A draft page comes back with `status: "draft"`. */
  page?: { id: string; title: string; slug: string; status: PageStatus } | null;
  category?: { id: string; name: string; slug: string } | null;
};

export type ProductType = "simple" | "variable";

/** A variable product's axis, e.g. name "Color", options ["Red", "Blue"]. */
export type ProductAttribute = {
  id: string;
  product_id: string;
  name: string;
  options: string[];
  sort_order: number;
};

/** One purchasable combination of a variable product (Red / Small) with its own price + stock. */
export type ProductVariation = {
  id: string;
  product_id: string;
  sku: string | null;
  price_micros: number;
  compare_at_price_micros: number | null;
  stock: number;
  is_active: boolean;
  image_url: string | null;
  image_media_id: string | null;
  /** Attribute name → chosen value, e.g. {"Color":"Red","Size":"Small"} */
  combination: Record<string, string>;
  /** Display text of the combination, e.g. "Red / Small" */
  label: string;
  sort_order: number;
  /** Media-library file behind `image_url`, when the image came from the library. */
  image_media?: MediaRef | null;
};

export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_micros: number;
  compare_at_price_micros: number | null;
  image_url: string | null;
  /** `simple` (own price/stock) or `variable` (price/stock come from `variations`). */
  type?: ProductType;
  sku?: string | null;
  /** Variable products only: the axes, in the order the admin defined them. */
  attributes?: ProductAttribute[];
  /** Variable products only: every combination, in display order. */
  variations?: ProductVariation[];
  /** Media-library file behind `image_url` (null for external URLs / legacy uploads). */
  image_media_id?: string | null;
  stock: number;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at?: string;
  category?: Pick<Category, "id" | "name" | "slug"> | null;
  /** Media-library file behind `image_url` (null for external URLs / legacy uploads). */
  image_media?: MediaRef | null;
  /** Extra images from the media library (storefront gallery), in display order. */
  gallery?: ProductGalleryItem[];
};

/** The slice of a media row that products embed (enough to render a thumbnail / alt text). */
export type MediaRef = Pick<MediaItem, "id" | "name" | "path" | "alt" | "width" | "height" | "variants" | "mime_type" | "kind" | "size" | "updated_at" | "deleted_at">;

export type ProductGalleryItem = {
  media_id: string;
  position: number;
  media: MediaRef | null;
};

/* ─── Media library ───────────────────────────────────────────────────────── */

export type MediaKind = "image" | "video" | "document" | "other";
export type MediaVariantName = "thumbnail" | "medium" | "large";
export type MediaVariant = { path: string; width: number; height: number; size: number };

export type MediaFolder = {
  id: string;
  name: string;
  created_at: string;
  /** Only present in admin queries. */
  file_count?: number;
};

export type MediaItem = {
  id: string;
  folder_id: string | null;
  /** Display / download name – renaming never changes the URL. */
  name: string;
  /** Object key inside the "media" bucket. */
  path: string;
  mime_type: string;
  kind: MediaKind;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  hash: string | null;
  variants: Partial<Record<MediaVariantName, MediaVariant>>;
  variants_size: number;
  uploaded_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One row per place a file is used: a product (main image / gallery), the site
 * settings (favicon / share image) or a page (featured image / share image /
 * inside the content). For the `page_*` roles the `product_*` columns carry the
 * page id / title / slug.
 */
export type MediaUsage = {
  media_id: string;
  product_id: string | null;
  product_name: string | null;
  product_slug: string | null;
  role: "image" | "gallery" | "variation" | "favicon" | "share_image" | "page_image" | "page_share_image" | "page_content";
};

/* ─── Pages (CMS) ─────────────────────────────────────────────────────────── */

export type PageStatus = "draft" | "published";

export type Tag = { id: string; name: string; slug: string };

export type PageAuthor = { id: string; full_name: string | null; email: string | null };

/** Row `pages` + the embeds the admin form / storefront template need. */
export type Page = {
  id: string;
  title: string;
  slug: string;
  /** Sanitised HTML (the editor's output, cleaned again on the server). */
  content: string;
  /** Plain-text summary derived from the content – default meta description. */
  excerpt: string | null;
  featured_image_id: string | null;
  /** External featured image – used when `featured_image_id` is null. */
  featured_image_url: string | null;
  status: PageStatus;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  robots_index: boolean;
  robots_follow: boolean;
  og_title: string | null;
  og_description: string | null;
  og_image_id: string | null;
  /** External share image – used when `og_image_id` is null. */
  og_image_url: string | null;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  featured_image?: MediaRef | null;
  og_image?: MediaRef | null;
  author?: PageAuthor | null;
  tags?: Tag[];
};

export type OrderStatus = "pending" | "processing" | "completed" | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_slug: string | null;
  image_url: string | null;
  unit_price_micros: number;
  quantity: number;
  line_total_micros: number;
  /** Which variation of a variable product was bought (null for simple products). */
  variation_id?: string | null;
  variation_label?: string | null;
};

export type Order = {
  id: string;
  order_number: number;
  user_id: string | null;
  status: OrderStatus;
  payment_method: string;
  payment_status: "unpaid" | "paid" | "refunded";
  /** Currency the customer saw at checkout; amounts below are USD micros × `exchange_rate` for display */
  currency: string;
  /** USD → `currency` rate stamped at checkout (1 for USD; missing before migration 12) */
  exchange_rate?: number | string | null;
  subtotal_micros: number;
  shipping_micros: number;
  total_micros: number;
  customer_email: string | null;
  shipping_name: string;
  shipping_phone: string | null;
  shipping_address_line1: string;
  shipping_address_line2: string | null;
  shipping_city: string;
  shipping_postal_code: string | null;
  shipping_country: string;
  notes: string | null;
  created_at: string;
  order_items?: OrderItem[];
};

export type ShippingInput = {
  name: string;
  phone?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  postal_code?: string;
  country: string;
  notes?: string;
};

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type PaymentStatus = Order["payment_status"];

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

/** Row `site_settings` (id = 1) as edited in /nemesis/settings – one tab per group. */
export type SiteSettings = {
  // General
  store_name: string;
  tagline: string | null;
  support_email: string | null;
  /** Telegram username without the "@" → https://t.me/<telegram> */
  telegram: string | null;
  /** WhatsApp number, digits only incl. country code → https://wa.me/<whatsapp> */
  whatsapp: string | null;
  /** Public URL of the favicon (a Media Library file), null = default icon */
  favicon_url: string | null;
  /** Media Library file behind `favicon_url` */
  favicon_media_id: string | null;
  // SEO
  seo_indexing: boolean;
  seo_site_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_og_image_url: string | null;
  /** Media Library file behind `seo_og_image_url` */
  seo_og_image_media_id: string | null;
  seo_google_verification: string | null;
  seo_bing_verification: string | null;
  /** X / Twitter handle without the "@" */
  seo_twitter: string | null;
  // WooCommerce
  manage_stock: boolean;
  /** Display currency (prices are stored in USD micros – see src/lib/money.ts) */
  currency: CurrencyCode;
  /** 1 USD = this many BDT; required while currency = BDT */
  usd_to_bdt_rate: number | null;
  // Home page (UI → Home page): which sections the storefront home renders
  home_show_categories: boolean;
  home_show_featured: boolean;
  home_show_filter: boolean;
  /** Heading above the filtered-products section; null = no heading */
  home_filter_title: string | null;
  // Extra → Theme Customization (see src/lib/theme.ts)
  theme_light: ThemeColors;
  theme_dark: ThemeColors;
  theme_gradients: ThemeGradients;
  /** true = dark mode reuses the light palette */
  theme_sync: boolean;
};

export type SiteSettingsRow = SiteSettings & { updated_at: string | null };

/** Media Library files behind the branding URLs of the settings row. */
export type SettingsMedia = { favicon: MediaRef | null; share_image: MediaRef | null };

/** Shape returned by the `admin_stats()` SQL function. */
export type AdminStats = {
  revenue_micros: number;
  revenue_30d_micros: number;
  orders_total: number;
  orders_30d: number;
  orders_pending: number;
  orders_processing: number;
  orders_completed: number;
  orders_cancelled: number;
  products_total: number;
  products_active: number;
  products_low_stock: number;
  categories_total: number;
  customers_total: number;
  customers_30d: number;
};

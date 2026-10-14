// Hand-written row types that mirror `supabase/migrations/*_init.sql`.
// Tip: once your schema grows, generate them instead:
//   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts

export type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  /** Listed in the storefront header navigation (admin-controlled). */
  show_in_menu: boolean;
  /** Only present in admin queries (`products(count)`). */
  product_count?: number;
};

export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  image_url: string | null;
  stock: number;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at?: string;
  category?: Pick<Category, "id" | "name" | "slug"> | null;
};

export type OrderStatus = "pending" | "processing" | "completed" | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_slug: string | null;
  image_url: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type Order = {
  id: string;
  order_number: number;
  user_id: string | null;
  status: OrderStatus;
  payment_method: string;
  payment_status: "unpaid" | "paid" | "refunded";
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
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

export type SiteSettings = {
  store_name: string;
  tagline: string | null;
  support_email: string | null;
};

/** Shape returned by the `admin_stats()` SQL function. */
export type AdminStats = {
  revenue_cents: number;
  revenue_30d_cents: number;
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

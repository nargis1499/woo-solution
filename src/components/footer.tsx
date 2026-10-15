import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings";
import { cacheLife } from "next/cache";
import { Separator } from "@/components/ui/separator";

/** Current year, cached per day so the static shell can be prerendered (Cache Components forbid bare `new Date()`). */
async function copyrightYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export async function Footer() {
  const [{ store_name, tagline, support_email }, year] = await Promise.all([getSiteSettings(), copyrightYear()]);
  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="container-page flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md space-y-1">
          <p className="text-base font-semibold text-foreground">{store_name}</p>
          {tagline && <p>{tagline}</p>}
          {support_email && (
            <p>
              Need help?{" "}
              <a href={`mailto:${support_email}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                {support_email}
              </a>
            </p>
          )}
        </div>
        <nav className="flex gap-6" aria-label="Footer">
          <Link href="/shop" className="hover:text-foreground">Shop</Link>
          <Link href="/cart" className="hover:text-foreground">Cart</Link>
          <Link href="/orders" className="hover:text-foreground">My orders</Link>
        </nav>
      </div>
      <Separator />
      <div className="container-page py-4 text-xs text-muted-foreground">
        © {year} {store_name}. Built with Next.js, Supabase and shadcn/ui.
      </div>
    </footer>
  );
}

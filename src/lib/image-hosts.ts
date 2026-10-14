/**
 * Remote hosts whose images may go through the Next.js image optimizer.
 * Shared by `next.config.ts` (remotePatterns) and <ProductImage> (which falls
 * back to an unoptimized <img> for any other host, e.g. a custom image URL an
 * admin pasted into the dashboard).
 *
 * Keep this file free of server-only imports – it is loaded by next.config.ts.
 */
export const OPTIMIZED_IMAGE_HOSTS: string[] = [
  "picsum.photos",
  "images.unsplash.com",
  "*.googleusercontent.com", // Google account avatars
  "*.supabase.co", // Supabase Storage (public buckets)
  "*.supabase.in",
];

/** Parses NEXT_PUBLIC_SUPABASE_URL so self-hosted / local Supabase Storage works too. */
export function supabaseImageHost(): { protocol: "http" | "https"; hostname: string; port: string } | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
      port: url.port,
    };
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".supabase.co"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

/** True when `src` is a relative path or an https URL on an allow-listed host. */
export function canOptimizeImage(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const url = new URL(src);
    // Only https sources are optimized. Plain-http ones (e.g. local Supabase at
    // http://127.0.0.1:54321) are rendered as-is: the optimizer refuses private/loopback
    // IPs for SSRF protection anyway.
    if (url.protocol !== "https:") return false;
    const supabase = supabaseImageHost();
    if (supabase && supabase.protocol === "https" && url.hostname === supabase.hostname && url.port === supabase.port) return true;
    return OPTIMIZED_IMAGE_HOSTS.some((p) => hostMatches(url.hostname, p));
  } catch {
    return false;
  }
}
